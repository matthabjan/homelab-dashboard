// Storage through its interface: each service's rows and the gauge's disk in; rows, alerts, the gauge's level and the
// card's row out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storage, usageLevel } from './storage.ts';
import type { GaugeDisk, StorageReport } from './storage.ts';
import type { StorageRow } from '$lib/types';

const th = { storageAmberPct: 70, storageWarnPct: 85 };
const noTrend = () => null;
const nas = { id: 'g-nas', name: 'NAS', href: null };
const pve = { id: 'g-pve', name: 'PVE', href: 'https://pve.home.arpa:8006' };
const row = (name: string, pct: number, metric?: string): StorageRow => ({ name, used: pct, total: 100, pct, sub: `${pct} / 100 GiB`, source: 'pve', metric });
const offsite: StorageRow = { name: 'offsite', offline: true, sub: 'detached 3 d', source: 'pbs' };
const alerts = (r: ReturnType<typeof storage>) => r.raised.map((a) => [a.key, a.sev, a.title, a.detail]);

test('usageLevel: amber from storageAmberPct, red from storageWarnPct', () => {
  assert.deepEqual([69, 70, 84, 85].map((p) => usageLevel(p, th)), ['ok', 'warn', 'warn', 'crit']);
});

test('rows: each service by name; an amber bar stays in the sheet, a red one warns; offline rows are grey and quiet', () => {
  const reports: StorageReport[] = [{ service: nas, rows: [row('tank10', 50), offsite, row('media · NAS', 75), row('tank9', 90)] }];
  const r = storage(reports, null, th, noTrend);
  assert.deepEqual(r.rows.map((x) => [x.name, x.group, x.level]), [['media · NAS', 'NAS', 'warn'], ['offsite', 'NAS', 'off'], ['tank9', 'NAS', 'crit'], ['tank10', 'NAS', 'ok']]);
  assert.deepEqual(alerts(r), [['storage-tank9', 'warn', 'tank9 is 90% full', '90 / 100 GiB']]);
  assert.deepEqual(r.panel, { id: 'storage', label: 'Storage', value: '90%', unit: 'full', sub: 'fullest: tank9 · 1 offline', level: 'warn', meta: '4 storages · 1 offline' });

  const amber = storage([{ service: nas, rows: [row('media · NAS', 75), offsite] }], null, th, noTrend);
  assert.deepEqual([amber.raised, amber.panel?.level, amber.panel?.sub], [[], 'none', 'fullest: media (NAS) · 1 offline'], 'the card is as bad as what is raised');
  assert.equal(storage([], null, th, noTrend).panel, null);
});

test('the gauge\'s disk warns once: by its storage row (same metric), else by itself; the local host\'s by the host', () => {
  const disk = (name: string, metric: string): GaugeDisk => ({ service: pve, node: 'pve', disk: { name, pct: 91, sub: '91 / 100 GiB', metric } });
  const zfs = row('local-zfs', 91, 'storage.pve.local-zfs');

  const shown = storage([{ service: pve, rows: [zfs] }], disk('local-zfs', 'storage.pve.local-zfs'), th, noTrend);
  assert.deepEqual([alerts(shown), shown.gaugeLevel], [[['storage-local-zfs', 'warn', 'local-zfs is 91% full', '91 / 100 GiB']], 'crit']);

  // host.storages left it out, or the gauge shows the root file system
  const root = storage([{ service: pve, rows: [] }], disk('root', 'host.root'), th, noTrend);
  assert.deepEqual(alerts(root), [['storage-root', 'warn', 'root is 91% full', '91 / 100 GiB']]);
  assert.equal(root.panel, null, 'the Storage row stays out: the gauge is on the System panel');

  const local = storage([], { node: 'this host', disk: { name: '/', pct: 91.4, sub: '426 / 466 GiB' } }, th, noTrend);
  assert.deepEqual(local.raised.map((a) => [a.source, a.key, a.title, a.detail]), [['host', 'local-disk', 'Disk / is 91% full', 'this host · 426 / 466 GiB']]);
  assert.equal(storage([], { node: 'h', disk: { name: '/', pct: null, sub: '' } }, th, noTrend).gaugeLevel, 'none', 'no reading yet');
});
