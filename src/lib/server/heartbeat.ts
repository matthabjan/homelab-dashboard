// Heartbeats: push checks for jobs (backups, cron) that call /api/heartbeat/<id> when they ran.
// A heartbeat is up while its last success is within `every + grace` and no failure was reported after it.
// What each id last reported lives in kv (`heartbeat:<id>`), so a restart doesn't make every job overdue.
import crypto from 'node:crypto';
import type { Heartbeat, HeartbeatRecord, HeartbeatState, Kv, Service } from '$lib/types';

export const kvKey = (id: string) => `heartbeat:${id}`;

/**
 * The stored record for a heartbeat, created (with `since: now`) the first time the dashboard sees it.
 */
export function record(kv: Kv, id: string, now: number): HeartbeatRecord {
  const r = kv.get<HeartbeatRecord>(kvKey(id));
  if (r && typeof r.since === 'number') return r;
  const fresh: HeartbeatRecord = { since: now, lastOk: null, lastFail: null };
  kv.set(kvKey(id), fresh);
  return fresh;
}

/**
 * Up while the last success is within every + grace and no failure came after it; a job that never reported
 * is pending until every + grace after the dashboard first saw it, then overdue.
 */
export function heartbeatState(hb: Heartbeat, r: HeartbeatRecord, now: number): HeartbeatState {
  const failed = r.lastFail != null && (r.lastOk == null || r.lastFail > r.lastOk);
  const due = (r.lastOk ?? r.since) + hb.every + hb.grace;
  const overdue = now > due;
  const state: HeartbeatState['state'] = failed || overdue ? 'down' : r.lastOk == null ? 'pending' : 'up';
  return { ...r, state, failed, overdueSince: !failed && overdue ? due : null };
}

/** Constant-time token comparison: both sides hashed first, so their lengths don't leak either. */
export function tokenMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const h = (s: string) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

/** At most one accepted call per second per id. */
export function createLimiter(windowMs = 1000): (id: string, now: number) => boolean {
  const last = new Map<string, number>();
  return (id, now) => {
    if (last.size > 1000) for (const [k, t] of last) if (now - t >= windowMs) last.delete(k);
    const prev = last.get(id);
    if (prev != null && now - prev < windowMs) return false;
    last.set(id, now); // only accepted calls count, so a refused one doesn't push the window
    return true;
  };
}

/**
 * Handle one call to the endpoint. An unknown id and a wrong token both answer 404. The rate limit counts only
 * calls with the right token, so someone without it can't hold a job's check-ins at 429.
 */
export function checkIn({ services, kv, now, allow }: { services: Service[]; kv: Kv; now: number; allow: (id: string, now: number) => boolean }, { id, token, ok }: { id: string; token: string | null; ok: boolean }): { status: 200 | 404 | 429; service?: Service } {
  const service = services.find((s) => s.heartbeat?.id === id);
  if (!service?.heartbeat || !tokenMatches(token, service.heartbeat.token)) return { status: 404 };
  if (!allow(id, now)) return { status: 429 };
  const r = record(kv, id, now);
  kv.set(kvKey(id), ok ? { ...r, lastOk: now } : { ...r, lastFail: now });
  return { status: 200, service };
}

/** The token from `Authorization: Bearer <t>`, else `?token=<t>`. */
export function tokenOf(request: Request, url: URL) {
  const auth = request.headers.get('authorization');
  return auth?.match(/^Bearer\s+(.+)$/i)?.[1].trim() ?? url.searchParams.get('token');
}

/** The endpoint's plain-text answer: "ok" with 200, so `curl -fsS` in a job fails only when the call did. */
export const response = (status: number) => new Response(status === 200 ? 'ok\n' : status === 429 ? 'too many requests\n' : 'not found\n', {
  status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
});
