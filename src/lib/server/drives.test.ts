// Drives through its interface: each service's drives in; rows and alerts out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drives } from './drives.ts';
import type { Drive } from '#lib/types';

const th = { driveLifeWarnPct: 10, driveTempWarnC: 70 };
const nas = { id: 'g-nas', name: 'NAS', href: null };
const pve = { id: 'g-pve', name: 'PVE', href: 'https://pve.home.arpa:8006' };
const drive = (model: string, extra: Partial<Drive> = {}): Drive => ({ model, serial: model, kind: 'SSD', size: 2e12, health: 'ok', lifeLeft: null, tempC: null, hours: null, written: null, errors: null, ...extra });
const alerts = (r: ReturnType<typeof drives>) => r.raised.map((a) => [a.service?.name, a.sev, a.key, a.title]);

test('a healthy drive: an ok row grouped by its service, nothing raised', () => {
  const r = drives([{ service: nas, drives: [drive('Disk 1', { lifeLeft: 96, tempC: 36, hours: 100 })] }], th);
  assert.deepEqual(r.raised, []);
  assert.deepEqual(r.rows.map((d) => [d.name, d.group, d.meta, d.status, d.level, d.life, d.lifeLevel]), [['Disk 1', 'NAS', 'SSD · 2 TB · NAS', 'ok', 'ok', 96, 'ok']]);
  assert.deepEqual(r.rows[0].details, [{ k: 'SMART', v: 'passed' }, { k: 'Rated endurance left', v: '96%' }, { k: 'Temperature', v: '36 °C' }, { k: 'Powered on', v: '4 d' }]);
  assert.deepEqual(r.rows[0].facts, [{ k: '', v: '36 °C', level: null }]);
});

test('each problem is one alert of the reporting service, keyed by the drive and what is wrong', () => {
  const r = drives([{ service: nas, drives: [
    drive('Worn', { lifeLeft: 7 }),
    drive('Hot', { tempC: 71 }),
    drive('Errors', { errors: 3 }),
    drive('Past', { health: 'warning' }),
    drive('Dying', { health: 'failing', lifeLeft: 2 })
  ] }], th);
  assert.deepEqual(alerts(r), [
    ['NAS', 'crit', 'drive-Dying-health', 'Dying is failing SMART'],
    ['NAS', 'warn', 'drive-Dying-life', 'Dying has 2% life left'],
    ['NAS', 'warn', 'drive-Errors-errors', 'Errors has 3 media errors or bad sectors'],
    ['NAS', 'warn', 'drive-Hot-temp', 'Hot is at 71 °C'],
    ['NAS', 'warn', 'drive-Past-health', 'Past has a past or minor SMART problem'],
    ['NAS', 'warn', 'drive-Worn-life', 'Worn has 7% life left']
  ]);
  assert.deepEqual(r.rows.map((d) => [d.name, d.status, d.level]), [['Dying', 'failing', 'crit'], ['Errors', 'check', 'warn'], ['Hot', 'check', 'warn'], ['Past', 'check', 'warn'], ['Worn', 'check', 'warn']]);
  assert.deepEqual(r.rows.find((d) => d.name === 'Worn')?.lifeLevel, 'warn');
});

test('a disk passed through whole is listed once, for the first service that reports it; rows sort by model, numbers in order', () => {
  const r = drives([
    { service: pve, drives: [drive('Disk 10', { where: 'pve' }), drive('Disk 9', { where: 'pve' }), drive('Shared', { serial: 'S1', where: 'pve' })] },
    { service: nas, drives: [drive('Shared', { serial: 'S1', health: 'failing' }), drive('Own', { serial: null }), drive('Own', { serial: null })] }
  ], th);
  assert.deepEqual(r.rows.map((d) => [d.name, d.group]), [['Disk 9', 'pve'], ['Disk 10', 'pve'], ['Shared', 'pve'], ['Own', 'NAS'], ['Own', 'NAS']]);
  assert.deepEqual(r.raised, [], 'the copy the VM reports is skipped, with its alert');
});

test('SMART unknown: a row without a verdict', () => {
  const r = drives([{ service: nas, drives: [drive('USB stick', { kind: 'USB', health: 'unknown' })] }], th);
  assert.deepEqual([r.rows[0].status, r.rows[0].level, r.rows[0].details], ['—', 'ok', [{ k: 'SMART', v: 'not reported' }]]);
});
