// Checks: what each kind of reading does to a service's check state, history and events, and the tile status it gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// DATA_DIR and CONFIG_DIR are read when config.ts is imported; history and events go into a db of their own
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-check-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.CONFIG_DIR = tmp;
delete process.env.DEMO;
const { kindOf, record, status } = await import('./check.ts');
const { heartbeatState } = await import('./heartbeat.ts');
const { lastProbes, recentEvents } = await import('./db.ts');
const { reasonText } = await import('./http.ts');
const { fmtClock, fmtDuration } = await import('./format.ts');
const { snapshotInput } = await import('./test-helpers.ts');
import type { ContainerState, HeartbeatRecord } from '$lib/types';
import type { TestService } from './test-helpers.ts';

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const S = 1000;
const H = 3600_000;
const T = Date.UTC(2026, 0, 1);

/** A service and its state, as the engine keeps them. Names are unique per test: they share one db. */
function one(def: TestService) {
  const input = snapshotInput({ services: [def] });
  const s = input.cfg.services[0];
  return { s, st: input.state(s.id) };
}
const events = (sid: string) => recentEvents(0, 100).filter((e) => e.sid === sid).reverse().map((e) => [e.sev, e.title, e.detail]);
/** History rows, oldest first. */
const history = (sid: string) => lastProbes(sid, 100).reverse().map((r) => r.ok);

test('kindOf: heartbeat, tcp:// or http probe, container, none', () => {
  const container = { state: 'running', health: null, exitCode: 0 };
  const hb = { id: 'x', every: H, grace: H, token: 't', backup: false };
  assert.equal(kindOf({ heartbeat: hb, probe: null, container: null }), 'heartbeat');
  assert.equal(kindOf({ heartbeat: null, probe: 'tcp://nas.home.arpa:22', container: null }), 'tcp');
  assert.equal(kindOf({ heartbeat: null, probe: 'https://web.home.arpa', container }), 'http', 'a siteMonitor wins over the container state');
  assert.equal(kindOf({ heartbeat: null, probe: null, container }), 'container');
  assert.equal(kindOf({ heartbeat: null, probe: null, container: null }), null);
});

test('probe: down after the second failure in a row, one event each way', () => {
  const { s, st } = one({ name: 'Web', probe: 'https://web.home.arpa' });
  assert.deepEqual(status(s, st, T), { lvl: 'unknown', status: 'Checking', line: null });

  record(s, st, { ok: true, ms: 12, code: 200 }, T);
  assert.deepEqual(status(s, st, T), { lvl: 'ok', status: 'Up', line: null });
  record(s, st, { ok: false, ms: null, code: 'ECONNREFUSED' }, T + 30 * S);
  assert.deepEqual([st.check.fails, st.check.down, st.check.since, st.check.reason], [1, false, T + 30 * S, reasonText('ECONNREFUSED')]);
  assert.equal(status(s, st, T)?.lvl, 'ok', 'one failure is not down yet');
  assert.deepEqual(events(s.id), []);

  record(s, st, { ok: false, ms: null, code: 'ECONNREFUSED' }, T + 60 * S);
  record(s, st, { ok: false, ms: null, code: 'ETIMEDOUT' }, T + 90 * S);
  assert.deepEqual([st.check.fails, st.check.down, st.check.since], [3, true, T + 30 * S]);
  const reason = reasonText('ETIMEDOUT');
  assert.deepEqual(status(s, st, T + 90 * S), {
    lvl: 'crit', status: 'Down', line: `Down since ${fmtClock(T + 30 * S)} · ${reason}`, lineLevel: 'crit',
    alert: { sev: 'crit', title: 'is down', detail: `${reason} · since ${fmtClock(T + 30 * S)}`, ts: T + 30 * S }
  });

  record(s, st, { ok: true, ms: 15, code: 200 }, T + 120 * S);
  assert.deepEqual([st.check.fails, st.check.down, st.check.since, st.check.ms], [0, false, null, 15]);
  assert.deepEqual(events(s.id), [['crit', 'Web went down', reasonText('ECONNREFUSED')], ['ok', 'Web recovered', `was down since ${fmtClock(T + 30 * S)}`]]);
  assert.deepEqual(history(s.id), [1, 0, 0, 0, 1]);
});

test('container: down at once when not running; unhealthy stays up but fails in the history', () => {
  const { s, st } = one({ name: 'Jellyfin', container: { state: 'running', health: null, exitCode: 0 } });
  /** The engine records the state label discovery just put on the service. */
  const see = (c: ContainerState, now: number) => { s.container = c; record(s, st, c, now); };

  see({ state: 'running', health: null, exitCode: 0 }, T);
  assert.deepEqual(status(s, st, T), { lvl: 'ok', status: 'Up', line: null });
  see({ state: 'running', health: 'unhealthy', exitCode: 0 }, T + 60 * S);
  assert.equal(st.check.down, false);
  assert.deepEqual(status(s, st, T), { lvl: 'warn', status: 'Unhealthy', line: 'Container unhealthy', alert: { sev: 'warn', title: 'is unhealthy', detail: 'container health check failing' } });

  see({ state: 'exited', health: null, exitCode: 137 }, T + 120 * S);
  assert.deepEqual([st.check.down, st.check.since, st.check.reason], [true, T + 120 * S, 'Container exited · exit 137']);
  assert.equal(status(s, st, T)?.line, `Down since ${fmtClock(T + 120 * S)} · Container exited · exit 137`);
  assert.deepEqual(events(s.id), [['crit', 'Jellyfin went down', 'Container exited · exit 137']]);
  assert.deepEqual(history(s.id), [1, 0, 0]);

  // before its first reading the tile shows the state from the labels
  const fresh = one({ name: 'Sonarr', container: { state: 'restarting', health: null, exitCode: 0 } });
  assert.deepEqual(status(fresh.s, fresh.st, T), { lvl: 'crit', status: 'Down', line: 'Container restarting' });
  record(fresh.s, fresh.st, (fresh.s.container as ContainerState), T);
  assert.deepEqual([fresh.st.check.down, fresh.st.check.reason], [true, 'Container restarting']);
});

test('heartbeat: pending changes nothing; up, overdue and a reported failure; history only from the timer', () => {
  const hb = { id: 'restic', every: 24 * H, grace: H, token: 't', backup: true };
  const { s, st } = one({ name: 'Restic', heartbeat: hb });
  const every = `every ${fmtDuration(24 * H)}`;
  const tick = (r: Partial<HeartbeatRecord>, now: number, opts?: { history?: boolean }) => record(s, st, heartbeatState(hb, { since: T, lastOk: null, lastFail: null, ...r }, now), now, opts);

  tick({}, T + H);
  assert.deepEqual([st.heartbeat?.state, st.check.checked], ['pending', null]);
  assert.deepEqual(status(s, st, T + H), { lvl: 'unknown', status: 'Waiting', line: `Waiting for the first run · ${every}`, lineLevel: 'muted' });
  assert.deepEqual(history(s.id), []);

  const ran = T + 2 * H;
  tick({ lastOk: ran }, ran + H);
  assert.deepEqual(status(s, st, ran + H), { lvl: 'ok', status: 'Up', line: `Last run ${fmtDuration(H)} ago · ${every}`, lineLevel: null });

  const due = ran + 25 * H;
  tick({ lastOk: ran }, due + 10 * 60_000);
  assert.deepEqual([st.check.down, st.check.reason], [true, 'Missed its run']);
  assert.deepEqual(status(s, st, due + 10 * 60_000), {
    lvl: 'crit', status: 'Down', line: `Overdue since ${fmtClock(due)}`,
    alert: { sev: 'crit', title: 'missed its run', detail: `last run ${fmtDuration(25 * H + 10 * 60_000)} ago · ${every}`, ts: due }
  });

  // the job runs, then reports a failure through the endpoint: events, but no history row
  tick({ lastOk: due + H }, due + H);
  tick({ lastOk: due + H, lastFail: due + 2 * H }, due + 2 * H, { history: false });
  assert.deepEqual([st.check.down, st.check.reason], [true, 'Reported a failure']);
  assert.deepEqual(status(s, st, due + 2 * H)?.alert, { sev: 'crit', title: 'reported a failure', detail: `${fmtClock(due + 2 * H)} · last run ${fmtDuration(H)} ago`, ts: due + 2 * H });
  assert.deepEqual(events(s.id).map((e) => e.slice(0, 2)), [['crit', 'Restic went down'], ['ok', 'Restic recovered'], ['crit', 'Restic went down']]);
  assert.deepEqual(history(s.id), [1, 0, 1]);
});

test('no check: no status, and readings change nothing', () => {
  const { s, st } = one({ name: 'Wiki' });
  assert.equal(status(s, st, T), null);
  record(s, st, { ok: false, ms: null, code: 'ECONNREFUSED' }, T);
  assert.deepEqual([st.check.checked, history(s.id)], [null, []]);
});
