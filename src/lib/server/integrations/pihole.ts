// Pi-hole — v6 (default): a session from POST /api/auth with the app password (`key`), reused until it expires
// or is refused, since Pi-hole limits concurrent sessions. v5 (`version: 5`): the API token as `auth=`.
import { trimUrl } from '../http.ts';
import { fmtNum } from '../format.ts';
import type { Alert, Context, Widget, WidgetResult } from '$lib/types';

/** POST /api/auth (v6). */
export interface PiholeAuth {
  session?:
    { valid: true; totp?: boolean; sid: string; validity: number } | { valid: false; totp?: boolean; sid?: null; validity?: number };
}

/** GET /api/stats/summary (v6). */
export interface PiholeSummary {
  queries?: { total?: number; blocked?: number; percent_blocked?: number; unique_domains?: number };
  gravity?: { domains_being_blocked?: number };
}

/** GET /api/dns/blocking (v6). */
export interface PiholeBlocking {
  blocking?: 'enabled' | 'disabled' | 'failed' | 'unknown';
  timer?: number | null;
}

/** GET /admin/api.php?summaryRaw (v5); `[]` without a valid token. */
export interface PiholeV5Summary {
  dns_queries_today?: number | string;
  ads_blocked_today?: number | string;
  ads_percentage_today?: number | string;
  domains_being_blocked?: number | string;
  status?: string;
}

/** `key` is the v6 app password or the v5 API token; `password` is accepted for it too. */
type PiholeWidget = Widget & { key?: string; version?: number | string };

interface PiholeState {
  session?: { sid: string; expires: number } | null;
}

/** A v6 session id, from ctx.state while it is valid. Null when Pi-hole has no password. */
async function session(base: string, w: PiholeWidget, ctx: Context, fresh = false): Promise<string | null> {
  const state = ctx.state as PiholeState;
  const s = state.session;
  if (!fresh && s && s.expires > ctx.now) return s.sid;
  const password = w.key ?? w.password;
  if (!password) return null;
  const res = await ctx.getJson<PiholeAuth>(`${base}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), insecure: ctx.insecure });
  if (!res.session?.valid) throw new Error('Pi-hole refused the password');
  // renewed 30 s early: Pi-hole extends a session on each call, but don't count on it
  state.session = { sid: res.session.sid, expires: ctx.now + (res.session.validity - 30) * 1000 };
  return res.session.sid;
}

/** GET a v6 endpoint; on 401 (expired or logged out) log in once more. */
async function v6<T>(base: string, path: string, w: PiholeWidget, ctx: Context): Promise<T> {
  const get = async (fresh: boolean) => {
    const sid = await session(base, w, ctx, fresh);
    return ctx.getJson<T>(`${base}${path}`, { headers: sid ? { 'X-FTL-SID': sid } : {}, insecure: ctx.insecure });
  };
  try {
    return await get(false);
  } catch (e) {
    if ((e as { status?: number }).status !== 401) throw e;
    (ctx.state as PiholeState).session = null;
    return get(true);
  }
}

type Reading = { queries: number; blockedPct: number; blocking: boolean };

async function readV6(base: string, w: PiholeWidget, ctx: Context): Promise<Reading> {
  const summary = await v6<PiholeSummary>(base, '/api/stats/summary', w, ctx);
  const blocking = await v6<PiholeBlocking>(base, '/api/dns/blocking', w, ctx);
  const q: NonNullable<PiholeSummary['queries']> = summary.queries ?? {};
  return { queries: q.total ?? 0, blockedPct: q.percent_blocked ?? 0, blocking: blocking.blocking !== 'disabled' };
}

async function readV5(base: string, w: PiholeWidget, ctx: Context): Promise<Reading> {
  const auth = w.key ?? w.password;
  const s = await ctx.getJson<PiholeV5Summary | []>(`${base}/admin/api.php?summaryRaw${auth ? `&auth=${encodeURIComponent(auth)}` : ''}`, { insecure: ctx.insecure });
  // without a valid token v5 answers [] instead of an error
  if (Array.isArray(s) || s.dns_queries_today == null) throw new Error('No data: check the API token');
  return { queries: Number(s.dns_queries_today), blockedPct: Number(s.ads_percentage_today), blocking: s.status !== 'disabled' };
}

export async function collect(widget: Widget, ctx: Context): Promise<WidgetResult> {
  const w = widget as PiholeWidget;
  const base = trimUrl(w.url);
  const r = Number(w.version) === 5 ? await readV5(base, w, ctx) : await readV6(base, w, ctx);
  const alerts: Alert[] = [];
  if (!r.blocking) alerts.push({ sev: 'warn', key: 'blocking', title: 'Blocking is disabled', detail: 'DNS queries are not filtered' });
  return {
    stats: [
      { k: 'queries', v: fmtNum(r.queries) },
      { k: 'blocked', v: `${r.blockedPct.toFixed(1)}%` }
    ],
    line: `${fmtNum(r.queries)} queries · ${r.blockedPct.toFixed(1)}% blocked`,
    alerts,
    dns: { queries: r.queries, blockedPct: r.blockedPct, avgMs: null, series: null, period: '24 h' }
  };
}
