import { getEngine } from '$lib/server/engine.js';

export function GET() {
  const ok = !!getEngine().snapshot;
  return new Response(ok ? 'ok' : 'starting', { status: ok ? 200 : 503 });
}
