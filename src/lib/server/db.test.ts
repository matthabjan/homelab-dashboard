// The schema's migrations: a new database, and databases as earlier releases left them, all end at this version's
// schema with their rows intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-db-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.CONFIG_DIR = tmp;
const { migrate } = await import('./db.ts');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const columns = (d: DatabaseSync, table: string) => d.prepare(`PRAGMA table_info(${table})`).all().map((c) => String(c.name));
const version = (d: DatabaseSync) => Number(d.prepare('PRAGMA user_version').get()?.user_version);
const indexes = (d: DatabaseSync) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => String(r.name));
const CURRENT = {
  probes: ['sid', 'ts', 'ok', 'ms'],
  metrics: ['key', 'ts', 'v'],
  events: ['id', 'ts', 'sev', 'sid', 'title', 'detail', 'outage'],
  opens: ['sid', 'n', 'last', 'score'],
  kv: ['k', 'v']
};
const INDEXES = ['events_sid_ts', 'events_ts', 'metrics_key_ts', 'probes_sid_ts', 'probes_ts'];
const isCurrent = (d: DatabaseSync) => {
  for (const [table, cols] of Object.entries(CURRENT)) assert.deepEqual(columns(d, table), cols, table);
  assert.deepEqual(indexes(d), INDEXES);
  assert.equal(version(d), 1);
};

// the tables as each release created them (db.js / db.ts at the tag)
const BASE = `
  CREATE TABLE probes (sid TEXT NOT NULL, ts INTEGER NOT NULL, ok INTEGER NOT NULL, ms REAL);
  CREATE INDEX probes_sid_ts ON probes (sid, ts);
  CREATE INDEX probes_ts ON probes (ts);
  CREATE TABLE metrics (key TEXT NOT NULL, ts INTEGER NOT NULL, v REAL NOT NULL);
  CREATE INDEX metrics_key_ts ON metrics (key, ts);
  CREATE INDEX events_ts ON events (ts);
  CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);`;
const EVENTS_OLD = 'CREATE TABLE events (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, sev TEXT NOT NULL, sid TEXT, title TEXT NOT NULL, detail TEXT);';
const V002 = `${EVENTS_OLD} CREATE TABLE opens (sid TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, last INTEGER); ${BASE}`;
const V010 = `${EVENTS_OLD} CREATE TABLE opens (sid TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, last INTEGER, score REAL NOT NULL DEFAULT 0); ${BASE}`;
const V044 = `CREATE TABLE events (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, sev TEXT NOT NULL, sid TEXT, title TEXT NOT NULL, detail TEXT, outage INTEGER);
  CREATE TABLE opens (sid TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, last INTEGER, score REAL NOT NULL DEFAULT 0); CREATE INDEX events_sid_ts ON events (sid, ts); ${BASE}`;
const ROWS = `
  INSERT INTO probes VALUES ('apps-web', 1000, 1, 12.5);
  INSERT INTO metrics VALUES ('host.cpu', 1000, 17);
  INSERT INTO events (ts, sev, sid, title, detail) VALUES (1000, 'crit', 'apps-web', 'Web went down', 'Timed out');
  INSERT INTO kv VALUES ('cert.validTo.apps-web', '123');`;
const old = (schema: string, opens: string) => {
  const d = new DatabaseSync(':memory:');
  d.exec(schema + ROWS + opens);
  return d;
};
const kept = (d: DatabaseSync) => {
  assert.deepEqual({ ...d.prepare('SELECT * FROM probes').get() }, { sid: 'apps-web', ts: 1000, ok: 1, ms: 12.5 });
  assert.deepEqual({ ...d.prepare('SELECT * FROM metrics').get() }, { key: 'host.cpu', ts: 1000, v: 17 });
  assert.deepEqual({ ...d.prepare('SELECT ts, sev, sid, title, detail, outage FROM events').get() }, { ts: 1000, sev: 'crit', sid: 'apps-web', title: 'Web went down', detail: 'Timed out', outage: null });
  assert.deepEqual({ ...d.prepare('SELECT * FROM kv').get() }, { k: 'cert.validTo.apps-web', v: '123' });
};

test('a new database gets the whole schema, and a second start changes nothing', () => {
  const d = new DatabaseSync(':memory:');
  migrate(d);
  isCurrent(d);
  d.exec("INSERT INTO opens (sid, n, last, score) VALUES ('a', 3, 1000, 2.5)");
  migrate(d);
  isCurrent(d);
  assert.deepEqual({ ...d.prepare('SELECT * FROM opens').get() }, { sid: 'a', n: 3, last: 1000, score: 2.5 });
});

test('a 0.0.x database: the open score starts from the open counts, events gain `outage` and their index', () => {
  const d = old(V002, "INSERT INTO opens (sid, n, last) VALUES ('apps-web', 7, 1000);");
  migrate(d);
  isCurrent(d);
  kept(d);
  assert.deepEqual({ ...d.prepare('SELECT * FROM opens').get() }, { sid: 'apps-web', n: 7, last: 1000, score: 7 });
});

test('a 0.1.0 database: its scores stay as they are', () => {
  const d = old(V010, "INSERT INTO opens (sid, n, last, score) VALUES ('apps-web', 7, 1000, 3.25);");
  migrate(d);
  isCurrent(d);
  kept(d);
  assert.deepEqual({ ...d.prepare('SELECT * FROM opens').get() }, { sid: 'apps-web', n: 7, last: 1000, score: 3.25 });
});

test('a 0.4.4 database (everything in place, no version yet) is only given its version', () => {
  const d = old(V044, "INSERT INTO opens (sid, n, last, score) VALUES ('apps-web', 7, 1000, 3.25);");
  assert.equal(version(d), 0);
  migrate(d);
  isCurrent(d);
  kept(d);
});

test('a database from a newer version is left as it is', () => {
  const d = new DatabaseSync(':memory:');
  migrate(d);
  d.exec('ALTER TABLE kv ADD COLUMN later TEXT; PRAGMA user_version = 9');
  migrate(d);
  assert.equal(version(d), 9);
  assert.deepEqual(columns(d, 'kv'), ['k', 'v', 'later']);
});
