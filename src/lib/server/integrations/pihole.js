// Pi-hole — v6 (default): a session from POST /api/auth with the app password (`key`), reused until it expires
// or is refused, since Pi-hole limits concurrent sessions. v5 (`version: 5`): the API token as `auth=`.
import { trimUrl } from '../http.js';
import { fmtNum } from '../format.js';
/** @import { Alert, Context, Widget, WidgetResult } from '$lib/types' */

/** A v6 session id, from ctx.state while it is valid. Null when Pi-hole has no password. */
async function session(base, w, ctx, fresh = false) {
  const s = ctx.state.session;
  if (!fresh && s && s.expires > ctx.now) return s.sid;
  const password = w.key ?? w.password;
  if (!password) return null;
  const res = await ctx.getJson(`${base}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), insecure: ctx.insecure });
  if (!res.session?.valid) throw new Error('Pi-hole refused the password');
  // renewed 30 s early: Pi-hole extends a session on each call, but don't count on it
  ctx.state.session = { sid: res.session.sid, expires: ctx.now + (res.session.validity - 30) * 1000 };
  return res.session.sid;
}

/** GET a v6 endpoint; on 401 (expired or logged out) log in once more. */
async function v6(base, path, w, ctx) {
  const get = async (fresh) => {
    const sid = await session(base, w, ctx, fresh);
    return ctx.getJson(`${base}${path}`, { headers: sid ? { 'X-FTL-SID': sid } : {}, insecure: ctx.insecure });
  };
  try {
    return await get(false);
  } catch (e) {
    if (e.status !== 401) throw e;
    ctx.state.session = null;
    return get(true);
  }
}

/** @returns {Promise<{ queries: number, blockedPct: number, blocking: boolean }>} */
async function readV6(base, w, ctx) {
  const summary = await v6(base, '/api/stats/summary', w, ctx);
  const blocking = await v6(base, '/api/dns/blocking', w, ctx);
  const q = summary.queries ?? {};
  return { queries: q.total ?? 0, blockedPct: q.percent_blocked ?? 0, blocking: blocking.blocking !== 'disabled' };
}

async function readV5(base, w, ctx) {
  const auth = w.key ?? w.password;
  const s = await ctx.getJson(`${base}/admin/api.php?summaryRaw${auth ? `&auth=${encodeURIComponent(auth)}` : ''}`, { insecure: ctx.insecure });
  // without a valid token v5 answers [] instead of an error
  if (Array.isArray(s) || s.dns_queries_today == null) throw new Error('No data: check the API token');
  return { queries: Number(s.dns_queries_today), blockedPct: Number(s.ads_percentage_today), blocking: s.status !== 'disabled' };
}

/**
 * @param {Widget} w
 * @param {Context} ctx
 * @returns {Promise<WidgetResult>}
 */
export async function collect(w, ctx) {
  const base = trimUrl(w.url);
  const r = Number(w.version) === 5 ? await readV5(base, w, ctx) : await readV6(base, w, ctx);
  /** @type {Alert[]} */
  const alerts = [];
  if (!r.blocking) alerts.push({ sev: 'warn', title: 'Blocking is disabled', detail: 'DNS queries are not filtered' });
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
