import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getEngine } from '#lib/server/engine.ts';
import { eventsOf, serviceEvents } from '#lib/server/db.ts';
import { withoutRepeats } from '#lib/server/attention.ts';
import { isBackupService } from '#lib/server/backups.ts';
import { serviceById } from '#lib/server/config.ts';

const WEEK = 7 * 86_400_000;

// Events over the last 7 days: one service's (?sid=, for its sheet), or the backup services' (?backups, for the Backups
// sheet: PBS and heartbeats marked `backup`). The snapshot only carries the last 20 events of all services.
export const GET: RequestHandler = ({ url }) => {
  const engine = getEngine();
  const byId = serviceById(engine.cfg);
  const hrefOf = (sid: string | null) => byId.get(sid ?? '')?.href ?? null;
  const since = Date.now() - WEEK;
  const headers = { 'cache-control': 'no-store' };
  if (url.searchParams.has('backups')) {
    const sids = engine.cfg.services.filter(isBackupService).map((s) => s.id);
    return json(eventsOf(sids, since).map((e) => ({ ...e, href: hrefOf(e.sid) })), { headers });
  }
  const sid = url.searchParams.get('sid');
  if (!sid || !byId.has(sid)) return new Response(null, { status: 404 });
  return json(withoutRepeats(engine.snapshot?.attention ?? [], serviceEvents(sid, since)).map((e) => ({ ...e, href: hrefOf(sid) })), { headers });
};
