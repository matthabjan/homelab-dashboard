// OPNsense — API key/secret as basic auth (homepage: username = key, password = secret).
import { trimUrl, basicAuth } from '../http.js';

export async function collect(w, ctx) {
  const base = trimUrl(w.url) + '/api';
  const opts = { headers: { Authorization: basicAuth(w.username ?? w.key, w.password ?? w.secret) }, insecure: ctx.insecure };
  const [activity, traffic] = await Promise.all([
    ctx.getJson(`${base}/diagnostics/activity/getActivity`, opts),
    ctx.getJson(`${base}/diagnostics/traffic/interface`, opts)
  ]);

  const idle = activity?.headers?.[2]?.match(/ ([0-9.]+)% idle/)?.[1];
  const cpu = idle != null ? 100 - parseFloat(idle) : null;
  const wan = traffic?.interfaces?.[w.wan || 'wan'];
  const rx = Number(wan?.['bytes received'] ?? NaN);
  const tx = Number(wan?.['bytes transmitted'] ?? NaN);

  // counters are cumulative: derive the rate from the previous sample
  let down = null, up = null;
  const prev = ctx.state.prev;
  if (prev && Number.isFinite(rx) && rx >= prev.rx) {
    const dt = (ctx.now - prev.ts) / 1000;
    if (dt > 0) {
      down = ((rx - prev.rx) * 8) / dt / 1e6;
      up = ((tx - prev.tx) * 8) / dt / 1e6;
    }
  }
  if (Number.isFinite(rx)) ctx.state.prev = { rx, tx, ts: ctx.now };
  if (down != null) { ctx.metric('net.down', down); ctx.metric('net.up', up); }
  if (cpu != null) ctx.metric('opnsense.cpu', cpu);

  const f = (v) => (v == null ? '—' : v >= 100 ? Math.round(v) : v.toFixed(1));
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
