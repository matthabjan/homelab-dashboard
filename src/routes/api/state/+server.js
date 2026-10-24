import { json } from '@sveltejs/kit';
import { getEngine } from '$lib/server/engine.js';

export function GET() {
  return json(getEngine().snapshot, { headers: { 'cache-control': 'no-store' } });
}
