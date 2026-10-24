// AdGuard Home — basic auth.
import { getJson, trimUrl, basicAuth } from '../http.js';
import { fmtNum } from '../format.js';

export async function collect(w, ctx) {
  const base = trimUrl(w.url) + '/control';
  const opts = { headers: { Authorization: basicAuth(w.username, w.password) }, insecure: ctx.insecure };
  const [stats, status] = await Promise.all([getJson(`${base}/stats`, opts), getJson(`${base}/status`, opts).catch(() => null)]);
  const q = stats.num_dns_queries ?? 0;
  const blocked = stats.num_blocked_filtering ?? 0;
  const blockedPct = q ? (blocked / q) * 100 : 0;
  const avgMs = (stats.avg_processing_time ?? 0) * 1000;
  const alerts = [];
  if (status && status.protection_enabled === false) alerts.push({ sev: 'warn', title: 'DNS protection is paused', detail: 'AdGuard Home filtering is disabled' });
  if (status && status.running === false) alerts.push({ sev: 'crit', title: 'AdGuard DNS not running', detail: 'DNS server reports not running' });
  return {
    stats: [
      { k: 'queries', v: fmtNum(q) },
      { k: 'blocked', v: `${blockedPct.toFixed(1)}%` },
      { k: 'avg', v: `${Math.round(avgMs)} ms` }
    ],
    line: `${fmtNum(q)} queries · ${blockedPct.toFixed(1)}% blocked`,
    alerts,
    dns: { queries: q, blockedPct, avgMs, series: Array.isArray(stats.dns_queries) ? stats.dns_queries : null }
  };
}
