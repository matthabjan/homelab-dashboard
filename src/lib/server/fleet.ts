// The fleet availability strip: the last 24 hours in 48 half-hour buckets, for all services together and for each.
import type { ProbeBucketRow } from './db.ts';
import type { Level } from '#lib/types';

export const BUCKETS = 48;
export const BUCKET_MS = 30 * 60_000;
const RANK: Record<Level, number> = { crit: 3, warn: 2, ok: 0 };
type Strip = (Level | 'none')[];

/**
 * The strip from the probes per service and bucket (db.ts#probeBuckets): a bucket is red when half its probes failed,
 * amber when a tenth did or one took over twice the service's Slow limit (`slowMs`), green otherwise; the fleet's
 * bucket is the worst of its services'. `beats` holds the same buckets per service, for its sheet.
 */
export function fleet(rows: ProbeBucketRow[], slowMs: (sid: string) => number): { fleet: Strip; beats: Map<string, Strip> } {
  const blank = (): Strip => Array.from({ length: BUCKETS }, () => 'none');
  const buckets = blank();
  const beats = new Map<string, Strip>();
  for (const r of rows) {
    // bucket indexes count from the start of the query, which may be up to a minute older than this build
    const i = Math.max(0, Math.min(BUCKETS - 1, Math.floor(Number(r.b))));
    const ratio = r.fails / r.n;
    const sid = String(r.sid);
    const lv: Level = ratio >= 0.5 ? 'crit' : ratio >= 0.1 || (r.maxms ?? 0) > slowMs(sid) * 2 ? 'warn' : 'ok';
    const was = buckets[i];
    if (was === 'none' || RANK[lv] > RANK[was]) buckets[i] = lv;
    let own = beats.get(sid);
    if (!own) beats.set(sid, (own = blank()));
    own[i] = lv;
  }
  return { fleet: buckets, beats };
}
