// Background engine: polls probes, widgets, certificates and temperatures,
// keeps runtime state, writes history and pushes snapshots to SSE clients.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { CONFIG_DIR, loadConfig, withDiscovered } from './config.js';
import { openDb, insertProbe, insertMetric, insertEvent, prune, kvGet, kvSet } from './db.js';
import { probe, certInfo, reasonText } from './http.js';
import { fmtClock } from './format.js';
import { readTemps } from './integrations/host.js';
import { DEMO, SCENARIO, demoProbe, demoCert, demoTemps, seedHistory } from './demo.js';
import { FIXTURES, fixtureTransport } from './demo/index.js';
import { buildSnapshot } from './snapshot.js';
import { INTEGRATIONS, ORDER, createContext } from './integrations/index.js';
/** @import { Config, Discovered, Service, ServiceState, Shared, Snapshot, Temps, Widget } from '$lib/types' */

const kv = { get: kvGet, set: kvSet };

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);

export class Engine extends EventEmitter {
  // both set by reload(), which start() runs first; unset before that (see hooks.server.js)
  /** @type {Config} */
  cfg;
  /** @type {Config} */
  base; // services.yaml only; cfg adds the services discovered from container labels
  /** @type {Discovered[]} */
  discovered = [];
  discoveredBy = new Map(); // widget service id → its last successful discovery
  /** @type {Map<string, ServiceState>} */
  rt = new Map();
  /** @type {Shared} */
  shared = {};
  /** @type {Temps | null} */
  temps = null;
  timers = [];
  /** @type {Snapshot | null} */
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
    this.base = loadConfig();
    this.cfg = withDiscovered(this.base, this.discovered);
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

  /** @returns {ServiceState} */
  state(id) {
    let st = this.rt.get(id);
    if (!st) this.rt.set(id, (st = { probe: { fails: 0, down: false, since: null, reason: null, ms: null, checked: null }, widget: null, wstate: {}, cert: null }));
    return st;
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
          if (p.down) insertEvent(now, 'ok', s.id, `${s.name} recovered`, `was down since ${fmtClock(p.since)}`);
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
    const list = /** @type {(Service & { widget: Widget })[]} */ (this.cfg.services.filter((s) => s.widget?.type && INTEGRATIONS[s.widget.type]));
    const run = async (s) => {
      const st = this.state(s.id);
      const ctx = createContext({
        transport: DEMO ? fixtureTransport(FIXTURES[s.widget.type], { scenario: SCENARIO }) : undefined,
        kv,
        settings,
        now,
        insecure: s.insecure,
        shared: this.shared,
        state: st.wstate,
        metric: (key, v) => insertMetric(key, now, v)
      });
      try {
        const res = await withTimeout(INTEGRATIONS[s.widget.type].collect(s.widget, ctx), 25_000, s.widget.type);
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
    this.updateDiscovered(list);

    if (settings.host.temperature) {
      this.temps = DEMO ? demoTemps() : await readTemps();
      if (this.temps?.cpu != null) insertMetric('host.temp', now, this.temps.cpu);
    }
    this.publish();
  }

  /** Rebuild cfg when the set of label-discovered services changed; a failed widget keeps its last list. */
  updateDiscovered(widgetServices) {
    const prev = this.discoveredBy;
    this.discoveredBy = new Map(widgetServices.map((s) => {
      const w = this.state(s.id).widget;
      return [s.id, w?.ok ? w.discovered ?? [] : prev.get(s.id) ?? []];
    }));
    const found = [...this.discoveredBy.values()].flat();
    if (JSON.stringify(found) === JSON.stringify(this.discovered)) return;
    const added = found.filter((d) => !this.discovered.some((o) => o.group === d.group && o.name === d.name));
    this.discovered = found;
    this.cfg = withDiscovered(this.base, found);
    const ids = new Set(this.cfg.services.map((s) => s.id));
    for (const id of this.rt.keys()) if (!ids.has(id)) this.rt.delete(id);
    if (added.length) {
      console.log(`[discovery] ${added.map((d) => `${d.group}/${d.name}`).join(', ')}`);
      this.runProbes().catch((e) => console.error('[probe]', e));
      this.runCerts().catch((e) => console.error('[cert]', e));
    }
  }

  async runCerts() {
    await Promise.all(
      this.cfg.services.filter((s) => s.probe?.startsWith('https')).map(async (s) => {
        const st = this.state(s.id);
        const c = DEMO ? demoCert(s) : await certInfo(s.probe);
        if (!c) return;
        // durable, so a renewal while the dashboard was down still shows up
        const key = `cert.validTo.${s.id}`;
        const prev = st.cert?.validTo ?? kvGet(key);
        if (prev != null && c.validTo > prev + 86_400_000) {
          insertEvent(Date.now(), 'ok', s.id, 'Certificate renewed', `${s.name} · valid ${Math.round((c.validTo - Date.now()) / 86_400_000)} d`);
        }
        if (c.validTo !== prev) kvSet(key, c.validTo);
        st.cert = c;
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

/** @returns {Engine} */
export function getEngine() {
  globalThis.__homelabEngine ??= new Engine();
  return globalThis.__homelabEngine;
}
