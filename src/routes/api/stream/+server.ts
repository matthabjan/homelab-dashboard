import type { RequestHandler } from './$types';
import type { Snapshot } from '$lib/types';
import { getEngine } from '$lib/server/engine.ts';

// Caps on open streams, so one client can't exhaust the server.
// Per-client needs ADDRESS_HEADER / XFF_DEPTH behind a proxy; otherwise every client shares the proxy's address.
const MAX_TOTAL = 100;
const MAX_PER_CLIENT = 10;
let total = 0;
const perClient = new Map<string, number>();

function clientAddress(getClientAddress: () => string): string {
  try { return getClientAddress(); } catch { return 'unknown'; }
}

/** Reserves a stream slot for `addr`. Returns a release function (safe to call twice), or null when full. */
function acquire(addr: string): (() => void) | null {
  if (total >= MAX_TOTAL || (perClient.get(addr) ?? 0) >= MAX_PER_CLIENT) return null;
  total++;
  perClient.set(addr, (perClient.get(addr) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    total--;
    const n = (perClient.get(addr) ?? 0) - 1;
    if (n > 0) perClient.set(addr, n);
    else perClient.delete(addr);
  };
}

// Server-Sent Events: pushes a fresh snapshot after every poll cycle.
export const GET: RequestHandler = ({ request, getClientAddress }) => {
  const release = acquire(clientAddress(getClientAddress));
  if (!release) return new Response('Too many open streams', { status: 429, headers: { 'retry-after': '30' } });

  const engine = getEngine();
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      const send = (snap: Snapshot) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(snap)}\n\n`)); } catch { cleanup?.(); }
      };
      const ping = setInterval(() => {
        try { controller.enqueue(enc.encode(`: ping\n\n`)); } catch { cleanup?.(); }
      }, 20_000);
      engine.on('update', send);
      if (engine.snapshot) send(engine.snapshot);
      cleanup = () => {
        clearInterval(ping);
        engine.off('update', send);
        release();
      };
      request.signal.addEventListener('abort', () => {
        cleanup?.();
        try { controller.close(); } catch {}
      });
    },
    cancel() { cleanup?.(); }
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
};
