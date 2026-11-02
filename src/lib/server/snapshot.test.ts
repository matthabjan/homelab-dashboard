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
const { createSnapshot, driveTempKey } = await import('./snapshot.ts');
const { snapshotInput } = await import('./test-helpers.ts');
const { insertProbe, insertMetric } = await import('./db.ts');
const { fmtClock } = await import('./format.ts');
const { record } = await import('./check.ts');
const { heartbeatState } = await import('./heartbeat.ts');
const { toDrive } = await import('./integrations/smart.ts');
import type { TestService } from './test-helpers.ts';
import type { Alert, Drive, Snapshot, Tile, WidgetState } from '$lib/types';

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
  const alert: Alert = { sev: 'crit', key: 'pool', title: 'Pool degraded', detail: 'raidz1' };
  const snap = build([
    probed('NAS', now, { state: { cert, widget: widget(now, [alert]) } }),
    probed('Backup', now, { state: { check: { fails: 2, down: true, since: now - MIN, reason: 'Timed out', ms: null, checked: now }, widget: widget(now, [alert]) } })
  ], now);
  const nas = tile(snap, 'NAS');
  assert.deepEqual([nas.level, nas.line, nas.lineLevel], ['crit', 'Pool degraded · raidz1', 'crit']);
  assert.deepEqual(alertsOf(snap, 'NAS').map((a) => [a.sev, a.title]), [['crit', 'NAS: Pool degraded'], ['warn', 'NAS: Certificate expires in 10 d']]);
  const backup = tile(snap, 'Backup');
  assert.deepEqual([backup.level, backup.status, backup.line], ['crit', 'Down', `Down since ${fmtClock(now - MIN)} · Timed out`]);
});

test('drives: a failing drive turns the reporting tile red, a past SMART problem amber; a down tile keeps its line', () => {
  const now = day(9);
  const drive = (model: string, serial: string, status: string) => toDrive({ model, serial, kind: 'HDD', size: 8e12, status, smart: null });
  const withDrives = (drives: Drive[]): WidgetState => ({ ...widget(now, []), drives });
  const snap = build([
    probed('NAS', now, { state: { widget: withDrives([drive('Disk A', 'A', 'BAD_STATUS')]) } }),
    probed('Backup', now, { state: { widget: withDrives([drive('Disk B', 'B', 'BAD_ATTRIBUTE_IN_THE_PAST')]) } }),
    probed('Old', now, { state: { check: { fails: 2, down: true, since: now - MIN, reason: 'Timed out', ms: null, checked: now }, widget: withDrives([drive('Disk C', 'C', 'BAD_SECTOR_MANY')]) } })
  ], now);
  assert.deepEqual(alertsOf(snap, 'NAS').map((a) => [a.sev, a.title]), [['crit', 'NAS: Disk A is failing SMART']], 'one alert, not one from OMV too');
  assert.deepEqual([tile(snap, 'NAS').level, tile(snap, 'NAS').line, tile(snap, 'NAS').lineLevel], ['crit', 'Disk A is failing SMART · HDD · 8 TB · NAS', 'crit']);
  assert.deepEqual([tile(snap, 'Backup').level, tile(snap, 'Backup').line], ['warn', 'Disk B has a past or minor SMART problem · HDD · 8 TB · Backup']);
  assert.deepEqual(snap.drives.map((d) => d.status), ['failing', 'check', 'failing']);
  assert.deepEqual([tile(snap, 'Old').level, tile(snap, 'Old').status, tile(snap, 'Old').line], ['crit', 'Down', `Down since ${fmtClock(now - MIN)} · Timed out`]);
});

test('trends: a storage row and a drive show 24 h from their metric, once there are two samples', () => {
  const now = day(14);
  const disk = toDrive({ model: 'Disk T', serial: 'T1', kind: 'HDD', size: 8e12, status: 'GOOD', smart: { tempC: 38, hours: null, written: null, lifeLeft: null, errors: null, failing: false } });
  for (let i = 1; i <= 6; i++) {
    insertMetric('storage.pve.tank', now - i * 60 * MIN, 50 + i);
    insertMetric(driveTempKey(disk), now - i * 60 * MIN, 35);
  }
  insertMetric('storage.pve.fresh', now - MIN, 10);
  const nas: TestService = probed('NAS', now, { state: { widget: { ...widget(now, []), drives: [disk], storage: [
    { name: 'tank', used: 50, total: 100, pct: 50, sub: '50 / 100 GiB', source: 'pve', metric: 'storage.pve.tank' },
    { name: 'fresh', used: 10, total: 100, pct: 10, sub: '10 / 100 GiB', source: 'pve', metric: 'storage.pve.fresh' },
    { name: 'none', used: 10, total: 100, pct: 10, sub: '10 / 100 GiB', source: 'pve' }
  ] } } });
  const snap = build([nas], now);
  const tank = snap.storage.find((s) => s.name === 'tank')?.trend;
  assert.ok(tank && tank.from === now - 6 * 60 * MIN);
  assert.deepEqual([tank.values[0], tank.values.at(-1)], [55.5, 51.5], 'oldest first, about two samples per bucket');
  assert.deepEqual(snap.storage.filter((s) => s.name !== 'tank').map((s) => s.trend), [null, null], 'one sample, or no metric: nothing to draw');
  assert.ok(snap.drives[0].temps?.values.every((v) => v == null || v === 35));
});

test('certificates: a warning under certWarnDays, critical under 3 days, then expired', () => {
  const now = day(4);
  const cert = (days: number) => ({ state: { cert: { validTo: now + days * D + MIN, trusted: true, selfSigned: false } } });
  const snap = build([probed('Soon', now, cert(10)), probed('Close', now, cert(2)), probed('Gone', now, cert(-1)), probed('Fine', now, cert(60))], now);
  const certAlert = (name: string) => alertsOf(snap, name).map((a) => [a.sev, a.title, a.detail]);
  assert.deepEqual(certAlert('Soon'), [['warn', 'Soon: Certificate expires in 10 d', 'soon.home.arpa']]);
  assert.deepEqual(certAlert('Close'), [['crit', 'Close: Certificate expires in 2 d', 'close.home.arpa']]);
  assert.deepEqual(certAlert('Gone'), [['crit', 'Gone: Certificate expired', 'gone.home.arpa']]);
  assert.deepEqual(certAlert('Fine'), []);
  // the tile is as bad as its alert, without its own name in front
  assert.deepEqual([tile(snap, 'Soon').level, tile(snap, 'Soon').line], ['warn', 'Certificate expires in 10 d · soon.home.arpa']);
  assert.deepEqual([tile(snap, 'Gone').level, tile(snap, 'Gone').line], ['crit', 'Certificate expired · gone.home.arpa']);
  assert.equal(tile(snap, 'Fine').cert?.days, 60);
});

test('verdict and facts: how many services are up, or the top attention item with the way to its service', () => {
  const now = day(5);
  const calm = build([probed('Web', now)], now);
  assert.deepEqual(calm.verdict, { level: 'ok', tag: 'All systems normal', title: 'Web is up', sub: '', action: null });
  assert.equal(calm.needCount, 0);
  assert.equal(build([probed('Web', now), probed('Mail', now)], now).verdict.title, 'All 2 services up');

  const issues = build([
    probed('Web', now, { state: { check: { fails: 2, down: true, since: now - MIN, reason: 'HTTP 502', ms: null, checked: now } } }),
    probed('Mail', now, { state: { cert: { validTo: now + 5 * D + MIN, trusted: true, selfSigned: false } } })
  ], now);
  assert.deepEqual([issues.verdict.level, issues.verdict.tag, issues.verdict.title, issues.verdict.action], ['crit', '2 need attention', 'Web is down', null], 'no href, so no Open action');
  assert.match(issues.verdict.sub, /^HTTP 502 · since \d\d:\d\d · 1 of 2 services up$/);
  const linked = build([probed('Web', now, { href: 'https://web.home.arpa', state: { check: { fails: 2, down: true, since: now - MIN, reason: 'HTTP 502', ms: null, checked: now } } })], now);
  assert.deepEqual(linked.verdict.action, { label: 'Open Web', href: 'https://web.home.arpa' });
  assert.deepEqual(issues.facts.map((f) => [f.k, f.v, f.level]), [['services up', '1 / 2', 'crit'], ['next cert', '5 d', 'warn']]);
});

test('a tile follows its attention: a full storage warns its tile; with a Proxmox host, so do the CPU and NVMe temperatures', () => {
  const now = day(7);
  const pve: TestService = { name: 'PVE', widget: { type: 'proxmox', url: 'https://pve.home.arpa:8006' }, state: { widget: { ...widget(now, []), storage: [{ name: 'local-zfs', used: 91, total: 100, pct: 91, sub: '91 / 100 GiB', source: 'pve' }] } } };
  const temps = { cpu: 80, nvme: [72], drives: [] };
  const snap = createSnapshot()(snapshotInput({ services: [pve, probed('Web', now)], temps }), now);
  assert.deepEqual(alertsOf(snap, 'PVE').map((a) => [a.sev, a.title]), [['warn', 'PVE: CPU at 80 °C'], ['warn', 'PVE: NVMe at 72 °C'], ['warn', 'PVE: local-zfs is 91% full']]);
  assert.deepEqual([tile(snap, 'PVE').level, tile(snap, 'PVE').line], ['warn', 'CPU at 80 °C · limit 75 °C'], 'the first raised among equals');
  assert.equal(tile(snap, 'Web').level, 'ok');
  // the local host has no tile: its alerts belong to no service
  const local = createSnapshot()(snapshotInput({ services: [probed('Web', now)], temps }), now);
  assert.deepEqual(local.attention.map((a) => [a.key, a.service]), [['host|cpu-temp', undefined], ['host|nvme-temp-0', undefined]]);
});

test('checks other than probes: a stopped container is down, a heartbeat that missed its run alerts', () => {
  const now = day(8);
  const hb = { id: 'restic', every: 24 * 60 * MIN, grace: 60 * MIN, token: 't', backup: true };
  const input = snapshotInput({ services: [
    { name: 'Jellyfin', container: { state: 'exited', health: null, exitCode: 1, done: false } },
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
  // the job with its schedule: next run expected `every` after the last one
  const [job] = snap.jobs;
  assert.deepEqual([job.name, job.state, job.lastOk, job.due, job.every, job.backup], ['Restic', 'down', lastOk, lastOk + 24 * 60 * MIN, hb.every, true]);
  assert.deepEqual(snap.backups, { overdue: 1, oldestAge: 26 * 60 * MIN, known: true });
});

test('healthy: services and jobs are counted apart', () => {
  const now = day(11);
  const hb = { id: 'sync', every: 7 * 24 * 60 * MIN, grace: 24 * 60 * MIN, token: 't', backup: true };
  const input = snapshotInput({ services: [probed('Web', now), probed('Mail', now), { name: 'Sync', heartbeat: hb }] });
  const sync = input.cfg.services[2];
  record(sync, input.state(sync.id), heartbeatState(hb, { since: now - D, lastOk: now - D, lastFail: null }, now), now);
  const snap = createSnapshot()(input, now);
  assert.deepEqual([snap.verdict.title, snap.verdict.sub], ['All 2 services up', '1 backup job on schedule']);
});

test('a tile names its check, so only timed checks (http, tcp) show a p95', () => {
  const now = day(9);
  const hb = { id: 'borg', every: 24 * 60 * MIN, grace: 60 * MIN, token: 't', backup: false };
  const snap = build([
    probed('Web', now),
    probed('Ssh', now, { probe: 'tcp://ssh.home.arpa:22' }),
    { name: 'Wud', container: { state: 'running', health: null, exitCode: 0, done: false } },
    { name: 'Borg', heartbeat: hb },
    { name: 'Docs' }
  ], now);
  assert.deepEqual(['Web', 'Ssh', 'Wud', 'Borg', 'Docs'].map((n) => tile(snap, n).check), ['http', 'tcp', 'container', 'heartbeat', null]);
});

test('fleet strip: probe failures colour their 30-minute bucket, on the fleet and on the tile', () => {
  const now = day(99); // later than the tests above: probeBuckets reads every row from the window start on
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

test('fleet strip: a slow probe is judged against its own service\'s latencyWarnMs', () => {
  const now = day(100); // later than every other test: probeBuckets reads every row from the window start on
  // both 1200 ms: over twice the default limit (250 ms), under twice the router's own (2000 ms)
  insertProbe('g-router', now - 85 * MIN, true, 1200);
  insertProbe('g-web', now - 10 * MIN, true, 1200);
  const snap = build([probed('Router', now, { latencyWarnMs: 2000 }), probed('Web', now)], now);
  const expected = Array.from({ length: 48 }, () => 'none');
  expected[45] = 'ok';
  expected[47] = 'warn';
  assert.deepEqual(snap.fleet, expected);
  assert.equal(tile(snap, 'Router').beats?.[45], 'ok');
  assert.equal(tile(snap, 'Web').beats?.[47], 'warn');
});

test('history is read once a minute: a rebuild within it reuses the strip, the next minute shows new probes', () => {
  const now = day(101); // later than every other test: probeBuckets reads every row from the window start on
  insertProbe('g-cached', now - 10 * MIN, true, 20);
  const builder = createSnapshot();
  const input = snapshotInput({ services: [probed('Cached', now)] });
  assert.equal(builder(input, now).fleet[47], 'ok');
  insertProbe('g-cached', now - 5 * MIN, false, null);
  insertProbe('g-cached', now - 4 * MIN, false, null);
  assert.equal(builder(input, now + 30_000).fleet[47], 'ok', 'within the minute');
  assert.equal(builder(input, now + 61_000).fleet[47], 'crit', 'after it');
});
