import { getEngine } from '$lib/server/engine.js';
import { response, tokenOf } from '$lib/server/heartbeat.js';

// A job reports a failed run. A POST body (the job's output) goes to the log only: it is upstream text.
/** @type {import('./$types').RequestHandler} */
export function GET({ params, request, url }) {
  return response(getEngine().heartbeat(params.id, tokenOf(request, url), false));
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ params, request, url }) {
  const body = (await request.text().catch(() => '')).slice(0, 2000);
  return response(getEngine().heartbeat(params.id, tokenOf(request, url), false, body));
}
