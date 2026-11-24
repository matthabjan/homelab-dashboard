// The browser's side of /api/stream: one reconnecting EventSource (`openStream`) and, on top of it, the dashboard's
// live snapshot with everything the page says about its freshness (`Live`).
import type { Snapshot } from '#lib/types';
import { changes } from './logic.ts';

interface StreamHandlers {
  /** one frame's data, as sent */
  message: (data: string) => void;
  /** the stream opened or delivered (`live`), or failed and is being retried (`reconnecting`) */
  state?: (s: 'live' | 'reconnecting') => void;
  /** the stream has been down past a short grace (a server restart is a blip), or is back */
  lost?: (lost: boolean) => void;
}

/**
 * Open /api/stream and keep it open: a failed stream is retried every 4 s, and at once when the tab shows again or
 * the device comes back online. `connect` (re)opens it now (the banner's Retry); `close` ends it for good.
 */
export function openStream(on: StreamHandlers): { connect: () => void; close: () => void } {
  let es: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let reconnecting = false;
  const connected = () => { reconnecting = false; on.state?.('live'); on.lost?.(false); clearTimeout(grace); grace = undefined; };
  const connect = () => {
    clearTimeout(retry);
    es?.close();
    es = new EventSource('/api/stream');
    es.onopen = connected;
    es.onmessage = (e: MessageEvent<string>) => { on.message(e.data); connected(); };
    es.onerror = () => {
      reconnecting = true;
      on.state?.('reconnecting');
      es?.close();
      grace ??= setTimeout(() => on.lost?.(true), 8000);
      retry = setTimeout(connect, 4000);
    };
  };
  const vis = () => { if (document.visibilityState === 'visible' && reconnecting) connect(); };
  const net = () => { if (navigator.onLine && reconnecting) connect(); };
  document.addEventListener('visibilitychange', vis);
  addEventListener('online', net);
  connect();
  return {
    connect,
    close() {
      es?.close(); clearTimeout(retry); clearTimeout(grace);
      document.removeEventListener('visibilitychange', vis); removeEventListener('online', net);
    }
  };
}

/** The dashboard's snapshot, kept current by the stream. Create it with the snapshot from load; `start` on mount. */
export class Live {
  snap = $state<Snapshot | null>(null);
  state = $state<'connecting' | 'live' | 'reconnecting'>('connecting');
  /** the page's clock, moved every 15 s and when the tab shows again: what "2 h ago" is measured from */
  now = $state(Date.now());
  /** the stream has been down past a short grace */
  lost = $state(false);
  offline = $state(false);
  /** services (and 'verdict') whose level changed in the last update, briefly highlighted */
  flash = $state(new Set<string>());
  stale = $derived(!!this.snap && this.now - this.snap.generatedAt > this.snap.staleAfter);
  /** a status page must not keep saying "all good" on old data: the page greys out instead */
  degraded = $derived(this.stale || this.lost || this.offline);
  /** the header's live state: the stream down, the data old, or current */
  header = $derived<'live' | 'reconnecting' | 'stale'>(this.state === 'reconnecting' ? 'reconnecting' : this.stale ? 'stale' : 'live');
  /** (re)open the stream now: the banner's Retry. Set by start() */
  connect: () => void = () => {};
  #unflash: ReturnType<typeof setTimeout> | undefined;

  constructor(initial: Snapshot | null) {
    this.snap = initial;
  }

  /** a new snapshot from the stream; whatever changed level is highlighted for a moment */
  receive(next: Snapshot) {
    const ids = this.snap ? changes(this.snap, next) : [];
    this.snap = next;
    if (!ids.length) return;
    this.flash = new Set(ids);
    clearTimeout(this.#unflash);
    this.#unflash = setTimeout(() => (this.flash = new Set()), 2400);
  }

  /** Open the stream and start the clock; returns what stops both (for onMount). */
  start(): () => void {
    const stream = openStream({
      message: (data) => this.receive(JSON.parse(data)),
      state: (s) => (this.state = s),
      lost: (l) => (this.lost = l)
    });
    this.connect = stream.connect;
    const tick = setInterval(() => (this.now = Date.now()), 15_000);
    const vis = () => { if (document.visibilityState === 'visible') this.now = Date.now(); };
    const net = () => { this.offline = !navigator.onLine; };
    document.addEventListener('visibilitychange', vis);
    addEventListener('online', net);
    addEventListener('offline', net);
    net();
    this.now = Date.now();
    return () => {
      stream.close(); clearInterval(tick); clearTimeout(this.#unflash);
      document.removeEventListener('visibilitychange', vis); removeEventListener('online', net); removeEventListener('offline', net);
    };
  }
}
