import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine.ts';

export const GET: RequestHandler = () => {
  return json(getEngine().snapshot, { headers: { 'cache-control': 'no-store' } });
};
