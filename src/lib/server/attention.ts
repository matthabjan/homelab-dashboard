// Attention: the alerts that need looking at. Checks, widgets, the infrastructure panels and the config raise them; this
// module names them after their service, keeps the time each first appeared (by key, never by title), orders them,
// counts what needs attention, and gives the headline, the feed and each tile's worst alert.
import type { AttentionItem, FeedEvent, FeedItem, Level, Service, Severity } from '$lib/types';

const RANK: Record<Severity, number> = { crit: 3, warn: 2, info: 1 };

/** An alert as its source raises it. Exactly one of `service` and `source` says whose it is. */
export type Raised = {
  sev: Severity;
  /** identifies the alert across builds within its service or source; titles may carry readings, keys don't */
  key: string;
  /** bare: the module puts the service's name in front unless the title already names it */
  title: string;
  detail?: string;
  /** when it began, if the source knows (a check went down); else when first raised */
  ts?: number;
  /** overrides the service's link (or gives a source's alert one) */
  href?: string | null;
} & (
  | { service: Pick<Service, 'id' | 'name' | 'href'>; source?: never }
  | { source: string; service?: never }
);

/** What a tile shows of its worst alert: the bare title, since the tile already says whose it is. */
export interface TileAlert {
  sev: 'crit' | 'warn';
  title: string;
  detail?: string;
}

export interface Closed {
  /** most severe first, then newest */
  items: AttentionItem[];
  /** the notes (info alerts), then the recent events that don't repeat an alert: what Activity lists */
  feed: FeedItem[];
  /** crit and warn items */
  needCount: number;
  headline: { level: Level; tag: string; title: string };
  /** the service's most severe crit or warn alert (the first raised among equals), or null */
  worst(sid: string): TileAlert | null;
}

/** "Pi-hole: Blocking is disabled", unless the title already names the service ("Pi-hole is down"). */
export const named = (service: string, title: string) => (title.toLowerCase().includes(service.toLowerCase()) ? title : `${service}: ${title}`);

type Entry = { item: AttentionItem; bare: string };

/**
 * One per snapshot builder: it remembers when each alert first appeared. Each build is one round:
 * `begin(now)`, `raise(…)` from every source, then `close(events)`; raising after close throws.
 */
export function createAttention() {
  let firstSeen = new Map<string, number>();
  return {
    begin(now: number) {
      const raised = new Map<string, Entry>();
      let closed = false;
      return {
        raise(r: Raised) {
          if (closed) throw new Error('attention: raise after close');
          const key = `${r.service ? r.service.id : r.source}|${r.key}`;
          const prev = raised.get(key);
          if (prev && RANK[prev.item.sev] >= RANK[r.sev]) return; // one alert per key: the more severe, the first among equals
          const item: AttentionItem = { sev: r.sev, key, title: r.service ? named(r.service.name, r.title) : r.title, detail: r.detail, href: r.href !== undefined ? r.href : r.service?.href ?? null, ts: Math.min(r.ts ?? now, now) };
          if (r.service) Object.assign(item, { sid: r.service.id, service: r.service.name });
          raised.set(key, { item, bare: r.title });
        },
        close(events: FeedEvent[]): Closed {
          closed = true;
          const entries = [...raised.values()];
          const seen = new Map<string, number>();
          for (const { item } of entries) {
            item.ts = Math.min(item.ts, firstSeen.get(item.key) ?? item.ts);
            seen.set(item.key, item.ts);
          }
          firstSeen = seen; // an alert that cleared and comes back is a new one
          const byRank = (a: AttentionItem, b: AttentionItem) => RANK[b.sev] - RANK[a.sev] || b.ts - a.ts;
          const items = entries.map((e) => e.item).sort(byRank);
          const needCount = items.filter((a) => a.sev !== 'info').length;
          const top = items[0];
          return {
            items,
            feed: [...items.filter((a) => a.sev === 'info'), ...withoutRepeats(items, events)],
            needCount,
            headline: needCount
              ? { level: top.sev as Level, tag: `${needCount} ${needCount === 1 ? 'needs' : 'need'} attention`, title: `${top.title}.` }
              : { level: 'ok', tag: 'All systems normal', title: 'Everything is running.' },
            worst(sid) {
              let w: Entry | null = null;
              for (const e of entries) if (e.item.sid === sid && e.item.sev !== 'info' && (!w || RANK[e.item.sev] > RANK[w.item.sev])) w = e;
              return w && { sev: w.item.sev as TileAlert['sev'], title: w.bare, detail: w.item.detail };
            }
          };
        }
      };
    }
  };
}

/** `events` without those that say what one of the alerts says (the alert logged it). Everything else stays: a repeat is a log, a service that went down twice did so twice. */
export function withoutRepeats<E extends { sid?: string | null; title: string }>(alerts: AttentionItem[], events: E[]): E[] {
  return events.filter((e) => !alerts.some((a) => (a.sid ?? null) === (e.sid ?? null) && a.title === (a.service ? named(a.service, e.title) : e.title)));
}
