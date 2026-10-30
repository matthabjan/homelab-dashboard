// AdGuard Home — basic auth.
import { trimUrl, basicAuth } from '../http.ts';
import { fmtNum } from '../format.ts';
import type { Alert, Context, Widget, WidgetResult } from '$lib/types';

/** GET /control/stats. */
export interface AdguardStats {
  num_dns_queries?: number;
  num_blocked_filtering?: number;
  /** seconds */
  avg_processing_time?: number;
  time_units?: 'hours' | 'days';
  /** queries per time unit, oldest first */
  dns_queries?: number[];
}

/** GET /control/status. */
export interface AdguardStatus {
  protection_enabled?: boolean;
  running?: boolean;
}

export async function collect(w: Widget, ctx: Context): Promise<WidgetResult> {
  const base = trimUrl(w.url) + '/control';
  const opts = { headers: { Authorization: basicAuth(w.username, w.password) }, insecure: ctx.insecure };
  const [stats, status] = await Promise.all([ctx.getJson<AdguardStats>(`${base}/stats`, opts), ctx.getJson<AdguardStatus>(`${base}/status`, opts).catch(() => null)]);
  const q = stats.num_dns_queries ?? 0;
  const blocked = stats.num_blocked_filtering ?? 0;
  const blockedPct = q ? (blocked / q) * 100 : 0;
  const avgMs = (stats.avg_processing_time ?? 0) * 1000;
  // one point per hour or day, covering AdGuard's statistics interval
  const series = Array.isArray(stats.dns_queries) ? stats.dns_queries : null;
  const alerts: Alert[] = [];
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
    dns: { queries: q, blockedPct, avgMs, series, period: series ? `${series.length} ${stats.time_units === 'days' ? 'd' : 'h'}` : null }
  };
}
