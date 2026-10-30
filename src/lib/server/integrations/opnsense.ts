// OPNsense — API key/secret as basic auth (homepage: username = key, password = secret).
import { trimUrl, basicAuth } from '../http.ts';
import type { Context, Widget, WidgetResult } from '$lib/types';

/** GET /api/diagnostics/activity/getActivity: `top` output; headers[2] is the CPU line. */
export interface OpnsenseActivity {
  headers?: string[];
}

/** GET /api/diagnostics/traffic/interface: cumulative counters per interface, as strings. */
export interface OpnsenseTraffic {
  interfaces?: Record<string, { 'bytes received'?: string; 'bytes transmitted'?: string }>;
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
  const [activity, traffic] = await Promise.all([
    ctx.getJson<OpnsenseActivity>(`${base}/diagnostics/activity/getActivity`, opts),
    ctx.getJson<OpnsenseTraffic>(`${base}/diagnostics/traffic/interface`, opts)
  ]);

  const idle = activity?.headers?.[2]?.match(/ ([0-9.]+)% idle/)?.[1];
  const cpu = idle != null ? 100 - parseFloat(idle) : null;
  const wan = traffic?.interfaces?.[w.wan || 'wan'];
  const rx = Number(wan?.['bytes received'] ?? NaN);
  const tx = Number(wan?.['bytes transmitted'] ?? NaN);

  // counters are cumulative: derive the rate from the previous sample
  let down: number | null = null, up: number | null = null;
  const prev = state.prev;
  if (prev && Number.isFinite(rx) && rx >= prev.rx) {
    const dt = (ctx.now - prev.ts) / 1000;
    if (dt > 0) {
      down = ((rx - prev.rx) * 8) / dt / 1e6;
      up = ((tx - prev.tx) * 8) / dt / 1e6;
    }
  }
  if (Number.isFinite(rx)) state.prev = { rx, tx, ts: ctx.now };
  if (down != null) { ctx.metric('net.down', down); ctx.metric('net.up', up); }
  if (cpu != null) ctx.metric('opnsense.cpu', cpu);

  const f = (v: number | null) => (v == null ? '—' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));
  return {
    stats: [
      { k: 'WAN ↓ Mbit/s', v: f(down) },
      { k: 'WAN ↑ Mbit/s', v: f(up) },
      { k: 'CPU', v: cpu == null ? '—' : `${Math.round(cpu)}%` }
    ],
    line: down == null ? 'Collecting traffic…' : `WAN ${f(down)} / ${f(up)} Mbit/s`,
    alerts: [],
    network: { down, up, source: 'OPNsense' }
  };
}
