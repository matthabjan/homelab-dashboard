// OPNsense — API key/secret as basic auth (homepage: username = key, password = secret).
// CPU and WAN traffic always; gateways, services and firmware when the key's user has those privileges.
import { trimUrl, basicAuth } from '../http.ts';
import { card, plural } from '../format.ts';
import { slowly } from './smart.ts';
import type { Alert, Context, Stat, Widget, WidgetResult } from '$lib/types';

/** GET /api/diagnostics/activity/getActivity: `top` output; headers[2] is the CPU line. */
export interface OpnsenseActivity {
  headers?: string[];
}

/** GET /api/diagnostics/traffic/interface: cumulative counters per interface, as strings. */
export interface OpnsenseTraffic {
  interfaces?: Record<string, { 'bytes received'?: string; 'bytes transmitted'?: string }>;
}

/** GET /api/routes/gateway/status. Metrics are text ("13.5 ms", "0.0 %"), "~" for an unmonitored gateway. */
export interface OpnsenseGateways {
  items?: {
    name: string;
    address?: string;
    /** none (online), down, force_down (marked down by hand), loss, delay, delay+loss */
    status: string;
    status_translated?: string;
    loss?: string;
    delay?: string;
  }[];
}

/** GET /api/core/service/search: the services OPNsense runs. */
export interface OpnsenseServices {
  rows?: { id: string; name: string; description?: string; running: 0 | 1; locked?: 0 | 1 }[];
}

/** GET /api/core/firmware/status: the last update check (a GET reads it, only a POST checks again). */
export interface OpnsenseFirmware {
  /** none (up to date, or never checked), update, upgrade (a new major release), error */
  status?: string;
  /** '1' when the updates need a reboot */
  status_reboot?: string;
  /** product_* after an update check; CORE_* (26.x) always, CORE_PKGVERSION with the hotfix suffix ("26.7.8_2") */
  product?: { product_version?: string; product_latest?: string; CORE_PKGVERSION?: string; CORE_VERSION?: string };
  /** pending packages by name */
  all_packages?: Record<string, { name?: string; old?: string; new?: string }>;
  /** pending upgrade sets (a major release) by name */
  all_sets?: Record<string, { name?: string; new?: string }>;
}

/** `key`/`secret` are accepted for username/password; `wan` names the WAN interface (default "wan"). */
type OpnsenseWidget = Widget & { key?: string; secret?: string; wan?: string };

interface OpnsenseState {
  prev?: { rx: number; tx: number; ts: number };
}

export async function collect(widget: Widget, ctx: Context): Promise<WidgetResult> {
  const w = widget as OpnsenseWidget;
  const state = ctx.state as OpnsenseState;
  const base = trimUrl(w.url) + '/api';
  const opts = { headers: { Authorization: basicAuth(w.username ?? w.key, w.password ?? w.secret) }, insecure: ctx.insecure };
  // gateways, services and firmware each need their own privilege: a key without them still gets traffic and CPU
  const optional = <T>(path: string) => ctx.getJson<T>(`${base}/${path}`, opts).catch(() => null);
  const [activity, traffic, gateways, services, firmware] = await Promise.all([
    ctx.getJson<OpnsenseActivity>(`${base}/diagnostics/activity/getActivity`, opts),
    ctx.getJson<OpnsenseTraffic>(`${base}/diagnostics/traffic/interface`, opts),
    optional<OpnsenseGateways>('routes/gateway/status'),
    optional<OpnsenseServices>('core/service/search'),
    // OPNsense checks for updates on its own schedule: reading the result every 10 minutes is enough
    slowly(ctx, 'firmware', () => ctx.getJson<OpnsenseFirmware>(`${base}/core/firmware/status`, opts))
  ]);

  const idle = activity?.headers?.[2]?.match(/ ([0-9.]+)% idle/)?.[1];
  const cpu = idle != null ? 100 - parseFloat(idle) : null;
  const { down, up } = wanRate(traffic?.interfaces?.[w.wan || 'wan'], state, ctx.now);
  if (down != null) { ctx.metric('net.down', down); ctx.metric('net.up', up); }
  if (cpu != null) ctx.metric('opnsense.cpu', cpu);

  const f = (v: number | null) => (v == null ? '—' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));
  const cpuText = cpu == null ? '—' : `${Math.round(cpu)}%`;
  const gw = gatewayFacts(gateways);
  const svc = serviceFacts(services);
  const fw = firmwareFacts(firmware);
  return {
    ...card([
      ...gw.problems,
      ...svc.facts,
      [{ k: 'WAN ↓ / ↑ Mbit/s', v: down == null ? '—' : `${f(down)} / ${f(up)}` }, down == null ? 'Collecting traffic…' : `WAN ${f(down)} / ${f(up)} Mbit/s`],
      [{ k: 'CPU', v: cpuText }, `CPU ${cpuText}`],
      ...gw.facts,
      ...fw.facts
    ]),
    alerts: [...gw.alerts, ...svc.alerts, ...fw.alerts],
    network: { down, up, source: 'OPNsense' }
  };
}

/** Mbit/s from the cumulative counters and the previous sample, kept in `state`; null on the first poll. */
function wanRate(wan: NonNullable<OpnsenseTraffic['interfaces']>[string] | undefined, state: OpnsenseState, now: number) {
  const rx = Number(wan?.['bytes received'] ?? NaN);
  const tx = Number(wan?.['bytes transmitted'] ?? NaN);
  let down: number | null = null, up: number | null = null;
  const prev = state.prev;
  // a counter that went down was reset (reboot): skip that sample instead of a negative rate
  if (prev && Number.isFinite(rx) && Number.isFinite(tx) && rx >= prev.rx && tx >= prev.tx) {
    const dt = (now - prev.ts) / 1000;
    if (dt > 0) {
      down = ((rx - prev.rx) * 8) / dt / 1e6;
      up = ((tx - prev.tx) * 8) / dt / 1e6;
    }
  }
  if (Number.isFinite(rx) && Number.isFinite(tx)) state.prev = { rx, tx, ts: now };
  return { down, up };
}

/**
 * A stat per gateway; a gateway that is down leads the card (critical), loss or delay above the gateway's own
 * thresholds warns. One marked down by hand is shown, not raised.
 */
function gatewayFacts(gateways: OpnsenseGateways | null) {
  const problems: [Stat, string][] = [];
  const facts: [Stat, string][] = [];
  const alerts: Alert[] = [];
  const items = gateways?.items ?? [];
  const metrics = (g: NonNullable<OpnsenseGateways['items']>[number]) => [g.delay, g.loss && `${g.loss} loss`].filter((m) => m && !m.startsWith('~')).join(' · ');
  for (const g of items) {
    const level = g.status === 'down' ? 'crit' : /loss|delay/.test(g.status) ? 'warn' : null;
    const shown = g.status === 'none' ? metrics(g) || g.status_translated || 'online' : (g.status_translated || g.status).toLowerCase();
    facts.push([{ k: g.name, v: shown, level }, `${g.name} ${shown}`]);
    const detail = [g.address, metrics(g)].filter(Boolean).join(' · ');
    if (level === 'crit') alerts.push({ sev: 'crit', key: `gateway-${g.name}`, title: `Gateway ${g.name} is down`, detail });
    if (level === 'warn') alerts.push({ sev: 'warn', key: `gateway-${g.name}`, title: `Gateway ${g.name}: ${g.status.includes('loss') ? 'packet loss' : 'high latency'}`, detail });
  }
  const down = items.filter((g) => g.status === 'down');
  if (down.length) problems.push([{ k: 'gateways down', v: String(down.length), level: 'crit' }, down.length === 1 ? `Gateway ${down[0].name} down` : `${down.length} gateways down`]);
  return { problems, facts, alerts };
}

/** Running / total, only when one is stopped. A locked service can't be checked (`nocheck`) when it reads stopped. */
function serviceFacts(services: OpnsenseServices | null) {
  const rows = (services?.rows ?? []).filter((r) => r.running || !r.locked);
  const stopped = rows.filter((r) => !r.running);
  const facts: [Stat, string][] = stopped.length ? [[{ k: 'services', v: `${rows.length - stopped.length} / ${rows.length}`, level: 'warn' }, `${plural(stopped.length, 'service')} stopped`]] : [];
  const alerts: Alert[] = stopped.map((r) => ({ sev: 'warn', key: `service-${r.id}`, title: `Service ${r.description || r.name} stopped`, detail: `OPNsense reports ${r.name} as not running` }));
  return { facts, alerts };
}

/** The installed version, and pending updates as a note, like apt updates on Proxmox. */
function firmwareFacts(fw: OpnsenseFirmware | null) {
  const facts: [Stat, string][] = [];
  const alerts: Alert[] = [];
  const version = fw?.product?.product_version ?? fw?.product?.CORE_PKGVERSION ?? fw?.product?.CORE_VERSION;
  if (version) facts.push([{ k: 'version', v: version }, `OPNsense ${version}`]);
  const reboot = fw?.status_reboot === '1' && 'needs a reboot';
  if (fw?.status === 'update') {
    const n = Object.keys(fw.all_packages ?? {}).length;
    const latest = fw.product?.product_latest;
    if (n) facts.push([{ k: 'updates', v: String(n) }, plural(n, 'update')]);
    alerts.push({ sev: 'info', key: 'updates', title: latest && latest !== version ? `OPNsense ${latest} available` : n ? `${plural(n, 'update')} available on OPNsense` : 'Updates available on OPNsense', detail: [version && `installed ${version}`, n && plural(n, 'package'), reboot].filter(Boolean).join(' · ') });
  }
  if (fw?.status === 'upgrade') {
    const next = Object.values(fw.all_sets ?? {}).find((s) => s.new)?.new;
    alerts.push({ sev: 'info', key: 'updates', title: `OPNsense upgrade${next ? ` to ${next}` : ''} available`, detail: `a new major release${version ? ` · installed ${version}` : ''}` });
  }
  return { facts, alerts };
}
