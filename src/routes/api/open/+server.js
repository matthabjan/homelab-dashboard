import { getEngine } from '$lib/server/engine.js';
import { recordOpen } from '$lib/server/db.js';

// Counts how often a service is opened, so pinned tiles can be ordered by use.
export async function POST({ request }) {
  // JSON only: browsers can't send it cross-site without a CORS preflight, which this route never allows
  if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415 });
  const { id } = await request.json().catch(() => ({}));
  const engine = getEngine();
  if (typeof id === 'string' && engine.cfg.services.some((s) => s.id === id)) {
    recordOpen(id);
    engine.publish();
  }
  return new Response(null, { status: 204 });
}
