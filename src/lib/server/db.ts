// Small time-series + event store on the built-in node:sqlite (no native deps).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { DATA_DIR } from './config.ts';
import type { WidgetEvent } from '$lib/types';

// One row of each query as SQLite returns it: INTEGER and REAL columns both come back as numbers.
export interface EventRow { ts: number; sev: WidgetEvent['sev']; sid: string | null; title: string; detail: string | null }
export interface ProbeRow { ts: number; ok: 0 | 1; ms: number | null }
/** probes per service and bucket: `b` is the bucket index from `since` */
export interface ProbeBucketRow { sid: string; b: number; fails: number; n: number; maxms: number | null }
interface MetricRow { ts: number; v: number }
interface OpenRow { sid: string; score: number; last: number }

let db: DatabaseSync | undefined;

export function openDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, 'dashboard.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS probes (sid TEXT NOT NULL, ts INTEGER NOT NULL, ok INTEGER NOT NULL, ms REAL);
    CREATE INDEX IF NOT EXISTS probes_sid_ts ON probes (sid, ts);
    CREATE INDEX IF NOT EXISTS probes_ts ON probes (ts);
    CREATE TABLE IF NOT EXISTS metrics (key TEXT NOT NULL, ts INTEGER NOT NULL, v REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS metrics_key_ts ON metrics (key, ts);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, sev TEXT NOT NULL, sid TEXT, title TEXT NOT NULL, detail TEXT);
    CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
    CREATE TABLE IF NOT EXISTS opens (sid TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, last INTEGER, score REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  `);
  // databases from before the decaying score start from their plain open counts
  if (!db.prepare('PRAGMA table_info(opens)').all().some((c) => c.name === 'score')) {
    db.exec('ALTER TABLE opens ADD COLUMN score REAL NOT NULL DEFAULT 0; UPDATE opens SET score = n');
  }
  return db;
}

const stmt = (() => {
  const cache = new Map<string, StatementSync>();
  return (sql: string): StatementSync => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = openDb().prepare(sql)));
    return s;
  };
})();
/** The rows of a query, typed as its SELECT list (SQLite doesn't check that; each query here names its columns). */
const all = <T>(sql: string, ...params: SQLInputValue[]) => stmt(sql).all(...params) as unknown as T[];
const one = <T>(sql: string, ...params: SQLInputValue[]) => stmt(sql).get(...params) as T | undefined;

export const insertProbe = (sid: string, ts: number, ok: boolean, ms: number | null | undefined) => stmt('INSERT INTO probes (sid, ts, ok, ms) VALUES (?, ?, ?, ?)').run(sid, ts, ok ? 1 : 0, ms ?? null);
export const insertMetric = (key: string, ts: number, v: number | null | undefined) => Number.isFinite(v) && v != null && stmt('INSERT INTO metrics (key, ts, v) VALUES (?, ?, ?)').run(key, ts, v);
export const insertEvent = (ts: number, sev: WidgetEvent['sev'], sid: string | null | undefined, title: string, detail?: string | null) => stmt('INSERT INTO events (ts, sev, sid, title, detail) VALUES (?, ?, ?, ?, ?)').run(ts, sev, sid ?? null, title, detail ?? null);

export function recentEvents(since: number, limit = 6) {
  return all<EventRow>('SELECT ts, sev, sid, title, detail FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT ?', since, limit);
}

export function lastProbes(sid: string, n: number) {
  return all<ProbeRow>('SELECT ts, ok, ms FROM probes WHERE sid = ? ORDER BY ts DESC LIMIT ?', sid, n);
}

export function probeStats(sid: string, since: number): { uptime: number | null; p95: number | null; n: number } {
  const rows = all<Pick<ProbeRow, 'ok' | 'ms'>>('SELECT ok, ms FROM probes WHERE sid = ? AND ts >= ?', sid, since);
  if (!rows.length) return { uptime: null, p95: null, n: 0 };
  const okRows = rows.flatMap((r) => (r.ok && r.ms != null ? [r.ms] : [])).sort((a, b) => a - b);
  const p95 = okRows.length ? okRows[Math.min(okRows.length - 1, Math.floor(okRows.length * 0.95))] : null;
  return { uptime: (rows.filter((r) => r.ok).length / rows.length) * 100, p95, n: rows.length };
}

export function uptimeSince(sid: string, since: number): number | null {
  const r = one<{ up: number | null; n: number }>('SELECT AVG(ok) * 100 AS up, COUNT(*) AS n FROM probes WHERE sid = ? AND ts >= ?', sid, since);
  return r?.n ? r.up : null;
}

/** Per-bucket failure ratio for every service, used for the fleet availability strip. */
export function probeBuckets(since: number, bucketMs: number) {
  return all<ProbeBucketRow>(
    'SELECT sid, CAST((ts - ?) / ? AS INTEGER) AS b, SUM(1 - ok) AS fails, COUNT(*) AS n, MAX(ms) AS maxms FROM probes WHERE ts >= ? GROUP BY sid, b',
    since, bucketMs, since
  );
}

/**
 * Averaged series for a metric, resampled into up to `points` buckets (null where no data).
 * Starts at the oldest sample when the history is shorter than the window, so a fresh install
 * shows a full-width line instead of a dot at the right edge. `from` is where it starts.
 */
export function series(key: string, since: number, until: number, points: number): { values: (number | null)[]; from: number } {
  const rows = all<MetricRow>('SELECT ts, v FROM metrics WHERE key = ? AND ts >= ? ORDER BY ts', key, since);
  const from = rows.length ? rows[0].ts : since;
  const n = Math.max(1, Math.min(points, Math.ceil(rows.length / 2))); // ~2 samples per bucket: no gaps from timer jitter
  const span = (until - from) / n || 1;
  const sums: number[] = new Array(n).fill(0);
  const counts: number[] = new Array(n).fill(0);
  for (const r of rows) {
    const i = Math.min(n - 1, Math.floor((r.ts - from) / span));
    sums[i] += r.v;
    counts[i]++;
  }
  return { values: sums.map((s, i) => (counts[i] ? s / counts[i] : null)), from };
}

/** Open count where each open loses half its weight every `halfLifeDays`; only the sum and its time are stored. */
const decayed = (score: number, last: number, now: number, halfLifeDays: number) => score * 0.5 ** (Math.max(0, now - last) / (halfLifeDays * 86_400_000));

export function recordOpen(sid: string, now: number, halfLifeDays: number) {
  const r = one<Pick<OpenRow, 'score' | 'last'>>('SELECT score, last FROM opens WHERE sid = ?', sid);
  const score = (r ? decayed(r.score, r.last, now, halfLifeDays) : 0) + 1;
  stmt('INSERT INTO opens (sid, n, last, score) VALUES (?, 1, ?, ?) ON CONFLICT(sid) DO UPDATE SET n = n + 1, last = excluded.last, score = excluded.score').run(sid, now, score);
}
/** Current decayed open score per service id. */
export function openScores(now: number, halfLifeDays: number): Record<string, number> {
  return Object.fromEntries(all<OpenRow>('SELECT sid, score, last FROM opens').map((r) => [r.sid, decayed(r.score, r.last, now, halfLifeDays)]));
}

/** What was stored under `k`, as it was stored (see `Kv`). */
export const kvGet = <T = unknown>(k: string): T | null => {
  const r = one<{ v: string }>('SELECT v FROM kv WHERE k = ?', k);
  return r ? (JSON.parse(r.v) as T) : null;
};
export const kvSet = (k: string, v: unknown) => stmt('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));

export function prune(retentionDays: number) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  stmt('DELETE FROM probes WHERE ts < ?').run(cutoff);
  stmt('DELETE FROM metrics WHERE ts < ?').run(cutoff);
  stmt('DELETE FROM events WHERE ts < ?').run(cutoff);
}

export function countProbes(): number {
  return one<{ n: number }>('SELECT COUNT(*) AS n FROM probes')?.n ?? 0;
}

export function transaction(fn: () => void) {
  const d = openDb();
  d.exec('BEGIN');
  try { fn(); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; }
}
