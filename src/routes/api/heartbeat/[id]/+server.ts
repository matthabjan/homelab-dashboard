import type { RequestHandler } from './$types';
import { getEngine } from '$lib/server/engine.ts';
import { response, tokenOf } from '$lib/server/heartbeat.ts';

// A job reports a successful run: GET or POST /api/heartbeat/<id>, token as `Authorization: Bearer` or ?token=.
// Unknown id and wrong token both answer 404.
export const GET: RequestHandler = ({ params, request, url }) => {
  return response(getEngine().heartbeat(params.id, tokenOf(request, url), true));
};
export const POST = GET;
