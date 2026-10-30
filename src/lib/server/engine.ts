// Background engine: polls probes, widgets, certificates and temperatures,
// keeps runtime state, writes history and pushes snapshots to SSE clients.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { CONFIG_DIR, loadConfig, withDiscovered } from './config.ts';
import { openDb, insertMetric, insertEvent, prune, kvGet, kvSet } from './db.ts';
import { reasonText } from './http.ts';
import { hostSource, type LocalState } from './local.ts';
import { checkIn, createLimiter, heartbeatState, record as heartbeatRecord } from './heartbeat.ts';
import { DEMO, demoSources } from './demo.ts';
import { liveSources } from './sources.ts';
import { createSnapshot } from './snapshot.ts';
import { blankCheck, kindOf, record } from './check.ts';
import { createIconFinder, iconCandidates } from './icons.ts';
import { INTEGRATIONS, ORDER, createContext } from './integrations/index.ts';
import type { Config, ContainerState, Discovered, HostVitals, Service, ServiceState, Shared, Snapshot, Sources, Temps, Widget } from '$lib/types';

const kv = { get: kvGet, set: kvSet };

/** `p`, or a rejection after `ms`; the timer is cleared either way, so a finished round leaves none behind. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

export class Engine extends EventEmitter {
  // both set by load(), which start() runs first; unset before that (see hooks.server.ts)
  cfg!: Config;
  base!: Config; // services.yaml only; cfg adds the services discovered from container labels
  sources: Sources;
  icons: ReturnType<typeof createIconFinder>;
  discovered: Discovered[] = [];
  discoveredBy = new Map<string, Discovered[]>(); // widget service id → its last successful discovery
  rt = new Map<string, ServiceState>();
  shared: Shared = {};
  temps: Temps | null = null;
  /** the machine the dashboard runs on, when `host.source` resolves to local */
  local: HostVitals | null = null;
  localState: LocalState = {}; // the previous /proc/stat totals, for CPU %
  /** the rounds' timers, set by schedule() */
  timers: ReturnType<typeof setTimeout>[] = [];
  /** undoes what start() set up besides the rounds */
  teardown: (() => void)[] = [];
  heartbeatLimit = createLimiter();
  /** service id → icon found for a service without `icon` */
  autoIcons = new Map<string, { icon: string; iconDark: string | null }>();
  buildSnapshot = createSnapshot();
  snapshot: Snapshot | null = null;
  started = false;
  probed = false; // the first probe round, 5 s after start

  /** `sources`: where readings come from (live, demo, or a test's script) */
  constructor(sources: Sources) {
    super();
    this.sources = sources;
    this.icons = createIconFinder({ kv, transport: sources.iconTransport });
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.setMaxListeners(200);
    openDb();
    this.reload();
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      const watcher = fs.watch(CONFIG_DIR, { recursive: false }, (_, file) => {
        if (!file || !/\.ya?ml$/.test(file)) return;
        clearTimeout(t);
        t = setTimeout(() => { console.log(`[config] ${file} changed — reloading`); this.reload(); }, 500);
      });
      this.teardown.push(() => { clearTimeout(t); watcher.close(); });
    } catch (e) { console.warn('[config] watch unavailable:', (e as Error).message); }
    const pruning = setInterval(() => prune(this.cfg.settings.retentionDays), 6 * 3600_000).unref();
    this.teardown.push(() => clearInterval(pruning));
  }

  /** Stop every timer and the config watcher; the state stays as it is. */
  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const undo of this.teardown) undo();
    this.teardown = [];
    this.started = false;
  }

  reload() {
    if (this.load()) this.schedule();
  }

  /**
   * Read the config files and publish. Returns false when that failed unexpectedly and the running config stays
   * (loadConfig records bad files instead of throwing); without a running config it throws.
   */
  load() {
    try {
      this.base = loadConfig();
    } catch (e) {
      console.error('[config] reload failed:', e);
      if (this.base) return false;
      throw e;
    }
    this.cfg = withDiscovered(this.base, this.discovered);
    this.shared = {}; // hand-offs (container counts per engine, guest ids) refill on the next widget round, without removed services
    const ids = new Set(this.cfg.services.map((s) => s.id));
    for (const id of this.rt.keys()) if (!ids.has(id)) this.rt.delete(id);
    this.sources.seed(this.cfg.services);
    this.publish();
    return true;
  }

  /** (Re)start the rounds at the intervals in settings; each runs once straight away (probes 5 s after start). */
  schedule() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    const iv = this.cfg.settings.intervals;
    const every = (fn: () => void, s: number) => { fn(); this.timers.push(setInterval(fn, s * 1000)); };
    const probes = () => this.runProbes().catch((e) => console.error('[probe]', e));
    // At process start the server isn't listening yet: a check of the dashboard itself would fail once on every start.
    if (this.probed) every(probes, iv.probe);
    else this.timers.push(setTimeout(() => { this.probed = true; every(probes, iv.probe); }, 5000));
    every(() => this.runWidgets().catch((e) => console.error('[widgets]', e)), iv.widgets);
    every(() => this.runCerts().catch((e) => console.error('[cert]', e)), iv.cert);
    every(() => this.findIcons().catch((e) => console.error('[icons]', e)), 3600);
  }

  state(id: string): ServiceState {
    let st = this.rt.get(id);
    if (!st) this.rt.set(id, (st = { check: blankCheck(), widget: null, wstate: {}, cert: null }));
    return st;
  }

  async runProbes() {
    const now = Date.now();
    await Promise.all(
      this.cfg.services.filter((s) => s.probe).map(async (s) => record(s, this.state(s.id), await this.sources.probe(s, now), now))
    );
    this.checkHeartbeats(now);
    this.publish();
  }

  async runWidgets() {
    const now = Date.now();
    const settings = this.cfg.settings;
    const list = this.cfg.services.filter((s): s is Service & { widget: Widget } => !!(s.widget?.type && INTEGRATIONS[s.widget.type]));
    const run = async (s: Service & { widget: Widget }) => {
      const st = this.state(s.id);
      const ctx = createContext({
        transport: this.sources.transport(s.widget.type),
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
        st.widget = { ok: true, ts: now, lastOk: now, ...res };
      } catch (caught) {
        // undici's "fetch failed" carries the reason in cause; getJson attaches the upstream body for the log
        const e = caught as Error & { cause?: { code?: string }; body?: string };
        const cause = e?.cause?.code ? reasonText(e.cause.code) : null;
        st.widget = { ok: false, ts: now, lastOk: st.widget?.lastOk ?? null, error: cause && e.message === 'fetch failed' ? cause : e.message, stats: st.widget?.stats ?? [], line: null, alerts: [] };
        console.warn(`[${s.widget.type}] ${s.name}: ${st.widget.error}${e?.body ? ` — ${e.body}` : ''}`);
      }
    };
    for (const s of list.filter((x) => ORDER.includes(x.widget.type))) await run(s);
    await Promise.all(list.filter((x) => !ORDER.includes(x.widget.type)).map(run));
    this.updateDiscovered(list);
    this.recordContainers(list, now);

    if (hostSource(this.cfg) === 'local') {
      this.local = await this.sources.local(settings.host, this.localState);
      // the same keys the Proxmox widget records, so the gauges' sparklines don't care where they came from
      if (this.local) { insertMetric('host.cpu', now, this.local.cpu); insertMetric('host.mem', now, this.local.memPct); }
    } else this.local = null;

    if (settings.host.temperature) {
      this.temps = await this.sources.temps();
      if (this.temps?.cpu != null) insertMetric('host.temp', now, this.temps.cpu);
    }
    this.publish();
  }

  /**
   * Label-discovered services without a siteMonitor are checked by their container state, so each state the
   * Portainer widget just read is recorded like a probe (uptime, strips). A failed widget records nothing.
   */
  recordContainers(widgetServices: Service[], now: number) {
    const fresh = new Set(widgetServices.flatMap((s) => {
      const w = this.state(s.id).widget;
      return w?.ok ? (w.discovered ?? []).map((d) => `${d.group}\0${d.name}`) : [];
    }));
    for (const s of this.cfg.services) {
      if (kindOf(s) === 'container' && fresh.has(`${s.group}\0${s.name}`)) record(s, this.state(s.id), (s.container as ContainerState), now);
    }
  }

  /**
   * Heartbeat services, on the probe timer: their state from what the endpoint stored. With `history`, each tick
   * is written as probe history, so uptime and the strip mean "on schedule".
   */
  checkHeartbeats(now: number, history = true) {
    for (const s of this.cfg.services) {
      if (!s.heartbeat) continue;
      record(s, this.state(s.id), heartbeatState(s.heartbeat, heartbeatRecord(kv, s.heartbeat.id, now), now), now, { history });
    }
  }

  /**
   * A call to /api/heartbeat/<id>[/fail]. The status code to answer; a failure's body is logged only, never shown.
   */
  heartbeat(id: string, token: string | null, ok: boolean, body?: string) {
    const now = Date.now();
    const { status, service } = checkIn({ services: this.cfg.services, kv, now, allow: this.heartbeatLimit }, { id, token, ok });
    if (!service) return status;
    if (!ok) console.warn(`[heartbeat] ${service.name} reported a failure${body ? ` — ${body.slice(0, 500)}` : ''}`);
    this.checkHeartbeats(now, false);
    this.publish();
    return status;
  }

  /** Rebuild cfg when the set of label-discovered services changed; a failed widget keeps its last list. */
  updateDiscovered(widgetServices: Service[]) {
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
    this.findIcons().catch((e) => console.error('[icons]', e));
  }

  /** Look up icons for services without `icon` (by name, container image, widget type); publishes when they changed. */
  async findIcons() {
    await this.icons.refresh();
    const found = new Map();
    for (const s of this.cfg.services) {
      if (s.icon) continue;
      const f = await this.icons.find(iconCandidates(s.name, s.image, s.widget?.type));
      if (f) found.set(s.id, f);
    }
    if (JSON.stringify([...found]) === JSON.stringify([...this.autoIcons])) return;
    this.autoIcons = found;
    this.publish();
  }

  async runCerts() {
    await Promise.all(
      this.cfg.services.filter((s) => s.probe?.startsWith('https')).map(async (s) => {
        const st = this.state(s.id);
        const c = await this.sources.cert(s);
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
      this.snapshot = this.buildSnapshot(this, Date.now());
      this.emit('update', this.snapshot);
    } catch (e) {
      console.error('[snapshot]', e);
    }
  }
}

export function getEngine(): Engine {
  const g = globalThis as typeof globalThis & { __homelabEngine?: Engine };
  g.__homelabEngine ??= new Engine(DEMO ? demoSources() : liveSources);
  return g.__homelabEngine;
}
