// The local host's vitals from /proc files in a temp directory, and the System panel they make without Proxmox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// DATA_DIR and CONFIG_DIR are read when config.js is imported; the snapshot reads history from the db
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-local-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.CONFIG_DIR = tmp;
delete process.env.HOST_NAME;
const { readLocal, hostSource } = await import('./local.js');
const { DEFAULT_SETTINGS } = await import('./config.js');
const { buildSnapshot } = await import('./snapshot.js');

const proc = path.join(tmp, 'proc');
fs.mkdirSync(proc);
const write = (name, text) => fs.writeFileSync(path.join(proc, name), text);
const stat = (user, idle) => `cpu  ${user} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 ${user} 0 0 ${idle} 0 0 0 0 0 0\nintr 1 2 3\n`;
const host = { ...DEFAULT_SETTINGS.host, disk: tmp };

write('meminfo', 'MemTotal:       16384000 kB\nMemFree:         1024000 kB\nMemAvailable:    4096000 kB\n');
write('uptime', '93784.52 180000.00\n');
write('cpuinfo', 'processor\t: 0\nmodel name\t: x\n\nprocessor\t: 1\n\nprocessor\t: 2\n\nprocessor\t: 3\n');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('CPU % is the change between two polls; the first poll has none', async () => {
  const state = {};
  write('stat', stat(1000, 9000));
  assert.equal((await readLocal(host, state, { procDir: proc }))?.cpu, null);
  write('stat', stat(1250, 9750)); // 250 busy of 1000
  assert.equal((await readLocal(host, state, { procDir: proc }))?.cpu, 25);
});

test('memory used is MemTotal − MemAvailable; threads, uptime and name', async () => {
  const v = await readLocal(host, {}, { procDir: proc });
  assert.equal(v?.maxmem, 16384000 * 1024);
  assert.equal(v?.mem, (16384000 - 4096000) * 1024);
  assert.equal(v?.memPct, 75);
  assert.equal(v?.cpus, 4);
  assert.equal(v?.uptime, '26 h');
  assert.equal(v?.node, 'this host');
  assert.equal((await readLocal({ ...host, name: 'docker-01' }, {}, { procDir: proc }))?.node, 'docker-01');
});

test('disk usage comes from statfs on host.disk', async () => {
  const v = await readLocal(host, {}, { procDir: proc });
  assert.equal(v?.disk.name, tmp);
  assert.ok(v?.disk.pct != null && v.disk.pct > 0 && v.disk.pct <= 100);
  const missing = await readLocal({ ...host, disk: path.join(tmp, 'nope') }, {}, { procDir: proc });
  assert.deepEqual(missing?.disk, { name: path.join(tmp, 'nope'), pct: null, sub: 'unavailable' });
});

test('no /proc/meminfo (not Linux) means no local vitals', async () => {
  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  assert.equal(await readLocal(host, {}, { procDir: empty }), null);
});

test('host.source auto picks Proxmox only when there is a proxmox widget', () => {
  const cfg = (services, source = 'auto') => /** @type {any} */ ({ settings: { ...DEFAULT_SETTINGS, host: { ...DEFAULT_SETTINGS.host, source } }, services });
  const pve = { name: 'PVE', widget: { type: 'proxmox' } };
  assert.equal(hostSource(cfg([])), 'local');
  assert.equal(hostSource(cfg([pve])), 'proxmox');
  assert.equal(hostSource(cfg([pve], 'local')), 'local');
  assert.equal(hostSource(cfg([], 'proxmox')), 'proxmox');
});

test('the System panel shows local vitals without a Guests fact', async () => {
  write('stat', stat(1000, 9000));
  const state = {};
  await readLocal(host, state, { procDir: proc });
  write('stat', stat(1100, 9900));
  const local = await readLocal(host, state, { procDir: proc });
  const engine = /** @type {any} */ ({
    cfg: { settings: DEFAULT_SETTINGS, groups: [], services: [], bookmarks: [], problems: [] },
    state: () => ({ probe: { fails: 0, down: false, since: null, reason: null, ms: null, checked: null }, widget: null, wstate: {}, cert: null }),
    autoIcons: new Map(),
    shared: {},
    temps: null,
    local
  });
  const snap = buildSnapshot(engine);
  assert.equal(snap.host?.name, 'this host');
  assert.equal(snap.host?.href, null);
  assert.deepEqual(snap.host?.facts, [{ label: 'Uptime', value: '26 h' }]);
  assert.deepEqual(snap.host?.gauges.map((g) => [g.key, g.val]), [['cpu', 10], ['mem', '11.7'], ['disk', Math.round(/** @type {number} */ (local?.disk.pct))]]);
});
