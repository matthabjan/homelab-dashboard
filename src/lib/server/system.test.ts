// The System panel through its interface: vitals, sensors and a metric history in; the panel and what it raises out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { system, type History, type SystemInput } from './system.ts';
import type { HostVitals } from '#lib/types';

const thresholds = { storageAmberPct: 70, tempMinC: 30, tempWarnC: 75, driveTempWarnC: 70 };
const GiB = 1024 ** 3;
const hw: HostVitals = { node: 'pve', cpu: 12.4, cpus: 8, mem: 41 * GiB, maxmem: 64 * GiB, memPct: 64, disk: { name: 'local-zfs', pct: 58, sub: '58 / 100 GiB', metric: 'storage.pve.local-zfs' }, io: { read: 2.5, write: 0.5 }, uptime: '38 d', guestsRunning: 6, guestsTotal: 7, updates: null };
const pve = { id: 'g-pve', name: 'PVE', href: 'https://pve.home.arpa:8006' };
const input = (over: Partial<SystemInput> = {}): SystemInput => ({ service: pve, hw, temps: null, diskLevel: 'ok', host: { source: 'auto', name: '', disk: '/', service: null, temperature: true, storage: null, storages: null } as unknown as SystemInput['host'], thresholds, ...over });
/** a history with `n` samples of `v` for the keys given, nothing for the others; `asked` lists the keys read */
const history = (keys: Record<string, number>, n = 4): History & { asked: string[] } => {
  const asked: string[] = [];
  const read: History = (key) => {
    asked.push(key);
    const v = keys[key];
    const values: (number | null)[] = v == null ? [null] : Array.from({ length: n }, () => v);
    return { values, lo: values, hi: values, from: 1000 };
  };
  return Object.assign(read, { asked });
};

test('nothing to show without vitals or sensors', () => {
  assert.deepEqual(system(input({ hw: null }), history({})), { host: null, raised: [] });
});

test('a Proxmox node: CPU as a chart, memory and disk as meters; the disk reads its own metric and takes its level from storage', () => {
  const h = history({ 'host.cpu': 10, 'host.mem': 64, 'storage.pve.local-zfs': 58, 'host.io.read': 2, 'host.io.write': 1 });
  const { host, raised } = system(input({ diskLevel: 'warn' }), h);
  assert.deepEqual(raised, []);
  assert.deepEqual(host?.gauges.map((g) => [g.key, g.view, g.val, g.level, g.sub, g.warn]), [
    ['cpu', 'chart', 12, 'ok', '8 threads', 75],
    ['mem', 'meter', 64, 'ok', '41.0 of 64 GiB', 80],
    ['disk', 'meter', 58, 'warn', 'local-zfs', 70]
  ]);
  assert.ok(h.asked.includes('storage.pve.local-zfs') && !h.asked.includes('host.disk'));
  assert.deepEqual([host?.name, host?.href], ['pve', 'https://pve.home.arpa:8006']);
  assert.deepEqual(host?.facts, [{ label: 'Uptime', value: '38 d' }, { label: 'Guests', value: '6 of 7 running' }]);
  assert.deepEqual([host?.io?.source, host?.io?.read, host?.io?.write, host?.io?.seriesRead?.length, host?.io?.from], ['pve', 2.5, 0.5, 4, 1000]);
});

test('the local host: its disk is recorded as host.disk, its name comes from settings, no link', () => {
  const h = history({ 'host.disk': 40 });
  const { host } = system(input({ service: undefined, hw: { ...hw, node: 'docker-01', io: null, guestsTotal: null }, host: { name: 'Box' } as SystemInput['host'] }), h);
  assert.ok(h.asked.includes('host.disk'));
  assert.deepEqual([host?.name, host?.href, host?.io, host?.facts.map((f) => f.label)], ['Box', null, null, ['Uptime']]);
});

test('a reading with fewer than two samples has no series', () => {
  const { host } = system(input(), history({ 'host.cpu': 10 }, 1));
  assert.equal(host?.gauges.find((g) => g.key === 'cpu')?.series, null);
  assert.deepEqual([host?.io?.seriesRead, host?.io?.from], [null, null]);
});

test('heat: the CPU warns at tempWarnC and is critical 10 °C above it, a hot NVMe warns; on a Proxmox node its service carries them', () => {
  const cool = system(input({ temps: { cpu: 50, nvme: [44], drives: [] } }), history({}));
  assert.deepEqual(cool.raised, []);
  assert.deepEqual(cool.host?.gauges.at(-1) && [cool.host.gauges.at(-1)?.key, cool.host.gauges.at(-1)?.level, cool.host.gauges.at(-1)?.sub], ['temp', 'ok', 'limit 75 °C']);
  const hot = system(input({ temps: { cpu: 80, nvme: [44, 71], drives: [] } }), history({ 'host.temp': 78 }));
  assert.deepEqual(hot.raised.map((a) => [a.service?.name, a.sev, a.key, a.title]), [['PVE', 'warn', 'cpu-temp', 'CPU at 80 °C'], ['PVE', 'warn', 'nvme-temp-1', 'NVMe at 71 °C']]);
  assert.deepEqual([hot.host?.gauges.at(-1)?.level, hot.host?.gauges.at(-1)?.sub], ['warn', 'CPU']);
  const local = system(input({ service: undefined, temps: { cpu: 86, nvme: [], drives: [] } }), history({}));
  assert.deepEqual(local.raised.map((a) => [a.source, a.sev, a.key]), [['host', 'crit', 'cpu-temp']]);
});

test('sensors without vitals: the panel is just the temperature', () => {
  const { host } = system(input({ hw: null, temps: { cpu: 50, nvme: [], drives: [] } }), history({}));
  assert.deepEqual([host?.name, host?.gauges.map((g) => g.key)], ['host', ['temp']]);
});
