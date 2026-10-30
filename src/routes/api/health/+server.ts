import type { RequestHandler } from './$types';
import { getEngine } from '$lib/server/engine.ts';

export const GET: RequestHandler = () => {
  const ok = !!getEngine().snapshot;
  return new Response(ok ? 'ok' : 'starting', { status: ok ? 200 : 503 });
};
