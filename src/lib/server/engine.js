// Background engine: polls probes, widgets, certificates and temperatures,
// keeps runtime state, writes history and pushes snapshots to SSE clients.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { CONFIG_DIR, loadConfig } from './config.js';
import { openDb, insertProbe, insertMetric, insertEvent, prune } from './db.js';
import { probe, certInfo, reasonText } from './http.js';
import { readTemps } from './integrations/host.js';
import { DEMO, demoProbe, demoCert, demoCollect, demoTemps, seedHistory } from './demo.js';
import { buildSnapshot } from './snapshot.js';
import * as proxmox from './integrations/proxmox.js';
import * as pbs from './integrations/pbs.js';
import * as opnsense from './integrations/opnsense.js';
import * as fritzbox from './integrations/fritzbox.js';
import * as adguard from './integrations/adguard.js';
import * as portainer from './integrations/portainer.js';
import * as openmediavault from './integrations/openmediavault.js';

const INTEGRATIONS = { proxmox, proxmoxbackupserver: pbs, opnsense, fritzbox, adguard, portainer, openmediavault };
const ORDER = ['proxmox']; // runs first: provides guest ids for backup freshness

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);

class Engine extends EventEmitter {
  cfg = null;
  rt = new Map();
  shared = {};
  temps = null;
  timers = [];
  snapshot = null;
  started = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.setMaxListeners(200);
    openDb();
    this.reload();
    let t;
    try {
      fs.watch(CONFIG_DIR, { recursive: false }, (_, file) => {
        if (!file || !/\.ya?ml$/.test(file)) return;
        clearTimeout(t);
        t = setTimeout(() => { console.log(`[config] ${file} changed — reloading`); this.reload(); }, 500);
      });
    } catch (e) { console.warn('[config] watch unavailable:', e.message); }
    setInterval(() => prune(this.cfg.settings.retentionDays), 6 * 3600_000).unref();
  }

  reload() {
    this.cfg = loadConfig();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    const ids = new Set(this.cfg.services.map((s) => s.id));
    for (const id of this.rt.keys()) if (!ids.has(id)) this.rt.delete(id);
    if (DEMO) seedHistory(this.cfg.services);
    const iv = this.cfg.settings.intervals;
    const every = (fn, s) => { fn(); this.timers.push(setInterval(fn, s * 1000)); };
    every(() => this.runProbes().catch((e) => console.error('[probe]', e)), iv.probe);
    every(() => this.runWidgets().catch((e) => console.error('[widgets]', e)), iv.widgets);
    every(() => this.runCerts().catch((e) => console.error('[cert]', e)), iv.cert);
    this.publish();
  }

  state(id) {
    if (!this.rt.has(id)) this.rt.set(id, { probe: { fails: 0, down: false, since: null, reason: null, ms: null, checked: null }, widget: null, wstate: {}, cert: null });
    return this.rt.get(id);
  }

  async runProbes() {
    const now = Date.now();
    await Promise.all(
      this.cfg.services.filter((s) => s.probe).map(async (s) => {
        const r = DEMO ? demoProbe(s, now) : await probe(s.probe);
        insertProbe(s.id, now, r.ok, r.ms);
        const p = this.state(s.id).probe;
        p.checked = now;
        p.ms = r.ms;
        if (r.ok) {
          if (p.down) insertEvent(now, 'ok', s.id, `${s.name} recovered`, `was down since ${new Date(p.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
          Object.assign(p, { fails: 0, down: false, since: null, reason: null });
        } else {
          p.fails++;
          if (p.fails === 1) p.since = now;
          p.reason = reasonText(r.code);
          if (p.fails >= 2 && !p.down) {
            p.down = true;
            insertEvent(now, 'crit', s.id, `${s.name} went down`, p.reason);
          }
        }
      })
    );
    this.publish();
  }

  async runWidgets() {
    const now = Date.now();
    const settings = this.cfg.settings;
    const list = this.cfg.services.filter((s) => s.widget?.type && INTEGRATIONS[s.widget.type]);
    const run = async (s) => {
      const st = this.state(s.id);
      const ctx = {
        settings,
        now,
        insecure: s.insecure,
        shared: this.shared,
        state: st.wstate,
        metric: (key, v) => insertMetric(key, now, v)
      };
      try {
        const res = DEMO
          ? await demoCollect(s.widget.type, s.widget, ctx)
          : await withTimeout(INTEGRATIONS[s.widget.type].collect(s.widget, ctx), 25_000, s.widget.type);
        for (const e of res.events || []) insertEvent(now, e.sev, s.id, e.title, e.detail);
        st.widget = { ok: true, ts: now, ...res };
      } catch (e) {
        const cause = e?.cause?.code ? reasonText(e.cause.code) : null;
        st.widget = { ok: false, ts: now, error: cause && e.message === 'fetch failed' ? cause : e.message, stats: st.widget?.stats ?? [], line: null, alerts: [] };
        console.warn(`[${s.widget.type}] ${s.name}: ${st.widget.error}${e?.body ? ` — ${e.body}` : ''}`);
      }
    };
    for (const s of list.filter((x) => ORDER.includes(x.widget.type))) await run(s);
    await Promise.all(list.filter((x) => !ORDER.includes(x.widget.type)).map(run));

    if (settings.host.temperature) {
      this.temps = DEMO ? demoTemps() : await readTemps();
      if (this.temps?.cpu != null) insertMetric('host.temp', now, this.temps.cpu);
    }
    this.publish();
  }

  async runCerts() {
    await Promise.all(
      this.cfg.services.filter((s) => s.probe?.startsWith('https')).map(async (s) => {
        const st = this.state(s.id);
        const c = DEMO ? demoCert(s) : await certInfo(s.probe);
        if (c && st.cert && c.validTo > st.cert.validTo + 86_400_000) {
          insertEvent(Date.now(), 'ok', s.id, 'Certificate renewed', `${s.name} · valid ${Math.round((c.validTo - Date.now()) / 86_400_000)} d`);
        }
        if (c) st.cert = c;
      })
    );
    this.publish();
  }

  publish() {
    try {
      this.snapshot = buildSnapshot(this);
      this.emit('update', this.snapshot);
    } catch (e) {
      console.error('[snapshot]', e);
    }
  }
}

export function getEngine() {
  globalThis.__homelabEngine ??= new Engine();
  return globalThis.__homelabEngine;
}
