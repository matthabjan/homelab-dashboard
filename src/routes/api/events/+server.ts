import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine.ts';
import { eventsOf, serviceEvents } from '$lib/server/db.ts';

const WEEK = 7 * 86_400_000;

// Events over the last 7 days: one service's (?sid=, for its sheet), or the backup services' (?backups, for the Backups
// sheet: PBS and heartbeats marked `backup`). The snapshot only carries the last 20 events of all services.
export const GET: RequestHandler = ({ url }) => {
  const engine = getEngine();
  const href = new Map(engine.cfg.services.map((s) => [s.id, s.href ?? null]));
  const since = Date.now() - WEEK;
  const headers = { 'cache-control': 'no-store' };
  if (url.searchParams.has('backups')) {
    const sids = engine.cfg.services.filter((s) => s.heartbeat?.backup || s.widget?.type === 'proxmoxbackupserver').map((s) => s.id);
    return json(eventsOf(sids, since).map((e) => ({ ...e, href: href.get(e.sid ?? '') ?? null })), { headers });
  }
  const sid = url.searchParams.get('sid');
  if (!sid || !href.has(sid)) return new Response(null, { status: 404 });
  return json(serviceEvents(sid, since).map((e) => ({ ...e, href: href.get(sid) ?? null })), { headers });
};
