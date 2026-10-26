// Small time-series + event store on the built-in node:sqlite (no native deps).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

let db;

export function openDb() {
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
  const cache = new Map();
  return (sql) => {
    if (!cache.has(sql)) cache.set(sql, openDb().prepare(sql));
    return cache.get(sql);
  };
})();

export const insertProbe = (sid, ts, ok, ms) => stmt('INSERT INTO probes (sid, ts, ok, ms) VALUES (?, ?, ?, ?)').run(sid, ts, ok ? 1 : 0, ms ?? null);
export const insertMetric = (key, ts, v) => Number.isFinite(v) && stmt('INSERT INTO metrics (key, ts, v) VALUES (?, ?, ?)').run(key, ts, v);
export const insertEvent = (ts, sev, sid, title, detail) => stmt('INSERT INTO events (ts, sev, sid, title, detail) VALUES (?, ?, ?, ?, ?)').run(ts, sev, sid ?? null, title, detail ?? null);

export function recentEvents(since, limit = 6) {
  return stmt('SELECT ts, sev, sid, title, detail FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT ?').all(since, limit);
}

export function lastProbes(sid, n) {
  return stmt('SELECT ts, ok, ms FROM probes WHERE sid = ? ORDER BY ts DESC LIMIT ?').all(sid, n);
}

export function probeStats(sid, since) {
  const rows = stmt('SELECT ok, ms FROM probes WHERE sid = ? AND ts >= ?').all(sid, since);
  if (!rows.length) return { uptime: null, p95: null, n: 0 };
  const okRows = rows.filter((r) => r.ok && r.ms != null).map((r) => r.ms).sort((a, b) => a - b);
  const p95 = okRows.length ? okRows[Math.min(okRows.length - 1, Math.floor(okRows.length * 0.95))] : null;
  return { uptime: (rows.filter((r) => r.ok).length / rows.length) * 100, p95, n: rows.length };
}

export function uptimeSince(sid, since) {
  const r = stmt('SELECT AVG(ok) * 100 AS up, COUNT(*) AS n FROM probes WHERE sid = ? AND ts >= ?').get(sid, since);
  return r.n ? r.up : null;
}

/** Per-bucket failure ratio for every service, used for the fleet availability strip. */
export function probeBuckets(since, bucketMs) {
  return stmt(
    'SELECT sid, CAST((ts - ?) / ? AS INTEGER) AS b, SUM(1 - ok) AS fails, COUNT(*) AS n, MAX(ms) AS maxms FROM probes WHERE ts >= ? GROUP BY sid, b'
  ).all(since, bucketMs, since);
}

/**
 * Averaged series for a metric, resampled into up to `points` buckets (null where no data).
 * Starts at the oldest sample when the history is shorter than the window, so a fresh install
 * shows a full-width line instead of a dot at the right edge. `from` is where it starts.
 */
export function series(key, since, until, points) {
  const rows = stmt('SELECT ts, v FROM metrics WHERE key = ? AND ts >= ? ORDER BY ts').all(key, since);
  const from = rows.length ? rows[0].ts : since;
  const n = Math.max(1, Math.min(points, Math.ceil(rows.length / 2))); // ~2 samples per bucket: no gaps from timer jitter
  const span = (until - from) / n || 1;
  const sums = new Array(n).fill(0);
  const counts = new Array(n).fill(0);
  for (const r of rows) {
    const i = Math.min(n - 1, Math.floor((r.ts - from) / span));
    sums[i] += r.v;
    counts[i]++;
  }
  return { values: sums.map((s, i) => (counts[i] ? s / counts[i] : null)), from };
}

/** Open count where each open loses half its weight every `halfLifeDays`; only the sum and its time are stored. */
const decayed = (score, last, now, halfLifeDays) => score * 0.5 ** (Math.max(0, now - last) / (halfLifeDays * 86_400_000));

export function recordOpen(sid, now, halfLifeDays) {
  const r = stmt('SELECT score, last FROM opens WHERE sid = ?').get(sid);
  const score = (r ? decayed(r.score, r.last, now, halfLifeDays) : 0) + 1;
  stmt('INSERT INTO opens (sid, n, last, score) VALUES (?, 1, ?, ?) ON CONFLICT(sid) DO UPDATE SET n = n + 1, last = excluded.last, score = excluded.score').run(sid, now, score);
}
/** Current decayed open score per service id. */
export function openScores(now, halfLifeDays) {
  return Object.fromEntries(stmt('SELECT sid, score, last FROM opens').all().map((r) => [r.sid, decayed(r.score, r.last, now, halfLifeDays)]));
}

export const kvGet = (k) => {
  const r = stmt('SELECT v FROM kv WHERE k = ?').get(k);
  return r ? JSON.parse(r.v) : null;
};
export const kvSet = (k, v) => stmt('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));

export function prune(retentionDays) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  stmt('DELETE FROM probes WHERE ts < ?').run(cutoff);
  stmt('DELETE FROM metrics WHERE ts < ?').run(cutoff);
  stmt('DELETE FROM events WHERE ts < ?').run(cutoff);
}

export function countProbes() {
  return stmt('SELECT COUNT(*) AS n FROM probes').get().n;
}

export function transaction(fn) {
  const d = openDb();
  d.exec('BEGIN');
  try { fn(); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; }
}
