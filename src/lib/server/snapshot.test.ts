// The status rules of the snapshot: tile levels and lines, attention, verdict, alert age and the fleet strip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// DATA_DIR and CONFIG_DIR are read when config.ts is imported; history goes into a db of its own
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-snapshot-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.CONFIG_DIR = tmp;
delete process.env.DEMO;
const { createSnapshot } = await import('./snapshot.ts');
const { snapshotInput } = await import('./test-helpers.ts');
const { insertProbe } = await import('./db.ts');
const { fmtClock } = await import('./format.ts');
const { record } = await import('./check.ts');
const { heartbeatState } = await import('./heartbeat.ts');
import type { TestService } from './test-helpers.ts';
import type { Alert, Snapshot, Tile, WidgetState } from '$lib/types';

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MIN = 60_000;
const D = 86_400_000;
// the fleet strip reads every service's history: each test gets its own day, far from the others
const day = (n: number) => Date.UTC(2026, 0, 1) + n * 10 * D;

const build = (services: TestService[], now: number) => createSnapshot()(snapshotInput({ services }), now);
/**
 * A probed service whose last probe at `now` succeeded.
 */
const probed = (name: string, now: number, extra: Omit<TestService, 'name'> = {}): TestService => ({ probe: `https://${name.toLowerCase()}.home.arpa`, ...extra, name, state: { check: { fails: 0, down: false, since: null, reason: null, ms: 12, checked: now }, ...extra.state } });
const tile = (snap: Snapshot, name: string): Tile => {
  const t = snap.groups.flatMap((g) => g.services).find((x) => x.name === name);
  assert.ok(t, `no tile ${name}`);
  return t;
};
const alertsOf = (snap: Snapshot, name: string) => snap.attention.filter((a) => a.service === name);
/** A widget result at `now` with these alerts. */
const widget = (now: number, alerts: Alert[]): WidgetState => ({ ok: true, ts: now, lastOk: now, stats: [], line: '', alerts });

test('a service that is down: crit tile, "Down since" line, crit alert dated when it went down', () => {
  const now = day(1);
  const since = now - 5 * MIN;
  const snap = build([probed('Web', now, { state: { check: { fails: 2, down: true, since, reason: 'Connection refused', ms: null, checked: now } } })], now);
  const t = tile(snap, 'Web');
  assert.deepEqual([t.level, t.status, t.line, t.lineLevel], ['crit', 'Down', `Down since ${fmtClock(since)} · Connection refused`, 'crit']);
  assert.deepEqual(alertsOf(snap, 'Web').map((a) => [a.sev, a.title, a.ts]), [['crit', 'Web is down', since]]);
});

test('slow: an hourly p95 over latencyWarnMs, from 10 samples on', () => {
  const now = day(2);
  for (let i = 0; i < 10; i++) insertProbe('g-slow', now - (i + 1) * 5 * MIN, true, 400);
  for (let i = 0; i < 9; i++) insertProbe('g-new', now - (i + 1) * 5 * MIN, true, 400);
  const snap = build([probed('Slow', now), probed('New', now)], now);
  const t = tile(snap, 'Slow');
  assert.deepEqual([t.level, t.status, t.line, t.lineLevel], ['warn', 'Slow', 'Slow · p95 400 ms', 'warn']);
  assert.deepEqual(alertsOf(snap, 'Slow').map((a) => [a.sev, a.title, a.detail]), [['warn', 'Slow is slow', 'p95 400 ms over the last hour · limit 250 ms']]);
  assert.deepEqual([tile(snap, 'New').level, tile(snap, 'New').status], ['ok', 'Up'], 'nine samples are too few to call it slow');
  assert.deepEqual(alertsOf(snap, 'New'), []);
});

test("precedence: a widget's crit alert outranks a cert warning; a down probe keeps its line", () => {
  const now = day(3);
  const cert = { validTo: now + 10 * D + MIN, trusted: true, selfSigned: false };
  const alert: Alert = { sev: 'crit', title: 'Pool degraded', detail: 'raidz1' };
  const snap = build([
    probed('NAS', now, { state: { cert, widget: widget(now, [alert]) } }),
    probed('Backup', now, { state: { check: { fails: 2, down: true, since: now - MIN, reason: 'Timed out', ms: null, checked: now }, widget: widget(now, [alert]) } })
  ], now);
  const nas = tile(snap, 'NAS');
  assert.deepEqual([nas.level, nas.line, nas.lineLevel], ['crit', 'Pool degraded · raidz1', 'crit']);
  assert.deepEqual(alertsOf(snap, 'NAS').map((a) => [a.sev, a.title]), [['crit', 'NAS: Pool degraded'], ['warn', 'Certificate expires in 10 d']]);
  const backup = tile(snap, 'Backup');
  assert.deepEqual([backup.level, backup.status, backup.line], ['crit', 'Down', `Down since ${fmtClock(now - MIN)} · Timed out`]);
});

test('certificates: a warning under certWarnDays, critical under 3 days, then expired', () => {
  const now = day(4);
  const cert = (days: number) => ({ state: { cert: { validTo: now + days * D + MIN, trusted: true, selfSigned: false } } });
  const snap = build([probed('Soon', now, cert(10)), probed('Close', now, cert(2)), probed('Gone', now, cert(-1)), probed('Fine', now, cert(60))], now);
  const certAlert = (name: string) => alertsOf(snap, name).map((a) => [a.sev, a.title, a.detail]);
  assert.deepEqual(certAlert('Soon'), [['warn', 'Certificate expires in 10 d', 'soon.home.arpa']]);
  assert.deepEqual(certAlert('Close'), [['crit', 'Certificate expires in 2 d', 'close.home.arpa']]);
  assert.deepEqual(certAlert('Gone'), [['crit', 'Certificate expired', 'gone.home.arpa']]);
  assert.deepEqual(certAlert('Fine'), []);
  assert.deepEqual([tile(snap, 'Gone').level, tile(snap, 'Gone').line], ['warn', 'Certificate expired']);
  assert.equal(tile(snap, 'Fine').cert?.days, 60);
});

test('verdict and facts: all normal, or the top attention item and how many need attention', () => {
  const now = day(5);
  const calm = build([probed('Web', now)], now);
  assert.deepEqual(calm.verdict, { level: 'ok', tag: 'All systems normal', title: 'Everything is running.', sub: '1 of 1 services up · no certs expiring soon' });
  assert.equal(calm.needCount, 0);

  const issues = build([
    probed('Web', now, { state: { check: { fails: 2, down: true, since: now - MIN, reason: 'HTTP 502', ms: null, checked: now } } }),
    probed('Mail', now, { state: { cert: { validTo: now + 5 * D + MIN, trusted: true, selfSigned: false } } })
  ], now);
  assert.deepEqual(issues.verdict, { level: 'crit', tag: '2 need attention', title: 'Web is down.', sub: '1 of 2 services up · 1 certificate expiring' });
  assert.deepEqual(issues.facts.map((f) => [f.k, f.v, f.level]), [['services up', '1 / 2', 'crit'], ['next cert', '5 d', 'warn']]);
});

test('alert age: an alert keeps the time it first appeared until it clears', () => {
  const now = day(6);
  const input = snapshotInput({ services: [{ name: 'Pi-hole', state: { widget: widget(now, [{ sev: 'warn', title: 'Blocking is disabled' }]) } }] });
  const st = input.state('g-pi-hole');
  const build = createSnapshot();
  const ts = (snap: Snapshot) => snap.attention.find((a) => a.service === 'Pi-hole')?.ts;
  assert.equal(ts(build(input, now)), now);
  st.widget = widget(now + MIN, st.widget?.alerts ?? []);
  assert.equal(ts(build(input, now + MIN)), now, 'still there: dated when first seen');
  assert.equal(ts(createSnapshot()(input, now + MIN)), now + MIN, 'another builder remembers nothing');

  st.widget = widget(now + 2 * MIN, []);
  assert.equal(ts(build(input, now + 2 * MIN)), undefined);
  st.widget = widget(now + 3 * MIN, [{ sev: 'warn', title: 'Blocking is disabled' }]);
  assert.equal(ts(build(input, now + 3 * MIN)), now + 3 * MIN, 'back after clearing: a new alert');
});

test('checks other than probes: a stopped container is down, a heartbeat that missed its run alerts', () => {
  const now = day(8);
  const hb = { id: 'restic', every: 24 * 60 * MIN, grace: 60 * MIN, token: 't', backup: true };
  const input = snapshotInput({ services: [
    { name: 'Jellyfin', container: { state: 'exited', health: null, exitCode: 1 } },
    { name: 'Restic', heartbeat: hb }
  ] });
  const [jellyfin, restic] = input.cfg.services;
  record(jellyfin, input.state(jellyfin.id), (jellyfin.container as import('$lib/types').ContainerState), now);
  const lastOk = now - 26 * 60 * MIN;
  record(restic, input.state(restic.id), heartbeatState(hb, { since: lastOk, lastOk, lastFail: null }, now), now);
  const snap = createSnapshot()(input, now);

  const j = tile(snap, 'Jellyfin');
  assert.deepEqual([j.level, j.status, j.line], ['crit', 'Down', `Down since ${fmtClock(now)} · Container exited · exit 1`]);
  assert.deepEqual(alertsOf(snap, 'Jellyfin').map((a) => [a.sev, a.title]), [['crit', 'Jellyfin is down']]);
  const due = lastOk + 25 * 60 * MIN;
  assert.deepEqual([tile(snap, 'Restic').status, tile(snap, 'Restic').line], ['Down', `Overdue since ${fmtClock(due)}`]);
  assert.deepEqual(alertsOf(snap, 'Restic').map((a) => [a.sev, a.title, a.ts]), [['crit', 'Restic missed its run', due]]);
  assert.equal(snap.verdict.tag, '2 need attention');
});

test('fleet strip: probe failures colour their 30-minute bucket, on the fleet and on the tile', () => {
  const now = day(99); // the latest day of all: probeBuckets reads every row from the window start on
  // bucket 45 of 48: both probes failed; bucket 47 (the last): fine
  insertProbe('g-flaky', now - 85 * MIN, false, null);
  insertProbe('g-flaky', now - 80 * MIN, false, null);
  insertProbe('g-flaky', now - 10 * MIN, true, 20);
  const snap = build([probed('Flaky', now)], now);
  const expected = Array.from({ length: 48 }, () => 'none');
  expected[45] = 'crit';
  expected[47] = 'ok';
  assert.deepEqual(snap.fleet, expected);
  assert.deepEqual(tile(snap, 'Flaky').beats, expected);
  assert.equal(Math.round(tile(snap, 'Flaky').uptime24 ?? 0), 33);
});
