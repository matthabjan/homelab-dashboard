import type { RequestHandler } from './$types';
import { getEngine } from '$lib/server/engine.ts';
import { response, tokenOf } from '$lib/server/heartbeat.ts';

// A job reports a failed run. A POST body (the job's output) goes to the log only: it is upstream text.
export const GET: RequestHandler = ({ params, request, url }) => {
  return response(getEngine().heartbeat(params.id, tokenOf(request, url), false));
};

export const POST: RequestHandler = async ({ params, request, url }) => {
  const body = (await request.text().catch(() => '')).slice(0, 2000);
  return response(getEngine().heartbeat(params.id, tokenOf(request, url), false, body));
};
