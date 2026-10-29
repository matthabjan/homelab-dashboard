import { getEngine } from '$lib/server/engine.js';
import { response, tokenOf } from '$lib/server/heartbeat.js';

// A job reports a successful run: GET or POST /api/heartbeat/<id>, token as `Authorization: Bearer` or ?token=.
// Unknown id and wrong token both answer 404.
/** @type {import('./$types').RequestHandler} */
export function GET({ params, request, url }) {
  return response(getEngine().heartbeat(params.id, tokenOf(request, url), true));
}
export const POST = GET;
