import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine.ts';
import { serviceEvents } from '$lib/server/db.ts';

const WEEK = 7 * 86_400_000;

// One service's events over the last 7 days, for its sheet. The snapshot only carries the last 20 events of all services.
export const GET: RequestHandler = ({ url }) => {
  const sid = url.searchParams.get('sid');
  const service = sid && getEngine().cfg.services.find((s) => s.id === sid);
  if (!service) return new Response(null, { status: 404 });
  const events = serviceEvents(service.id, Date.now() - WEEK).map((e) => ({ ...e, href: service.href ?? null }));
  return json(events, { headers: { 'cache-control': 'no-store' } });
};
