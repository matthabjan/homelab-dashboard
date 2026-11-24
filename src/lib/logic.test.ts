import test from 'node:test';
import assert from 'node:assert/strict';
import { changes, grouped, moved, score, viewStep } from './logic.ts';
import type { Snapshot } from '#lib/types';

const snap = (verdict: string, tiles: Record<string, string>) =>
  ({ verdict: { level: verdict }, groups: [{ name: 'g', services: Object.entries(tiles).map(([id, level]) => ({ id, level })) }] }) as unknown as Snapshot;

test('changes: the services whose level changed, and the verdict; new and removed services are not changes', () => {
  assert.deepEqual(changes(snap('ok', { a: 'ok', b: 'ok' }), snap('ok', { a: 'ok', b: 'ok' })), []);
  assert.deepEqual(changes(snap('ok', { a: 'ok', b: 'ok' }), snap('crit', { a: 'crit', b: 'ok' })), ['a', 'verdict']);
  assert.deepEqual(changes(snap('ok', { a: 'ok' }), snap('ok', { b: 'warn' })), []);
  assert.deepEqual(changes(snap('warn', { a: 'warn' }), snap('ok', { a: 'ok', c: 'crit' })), ['a', 'verdict']);
});

test('viewStep: leaving Home pushes, the other two replace each other, Home goes back onto its entry', () => {
  assert.equal(viewStep('home', 'home', false), 'stay');
  assert.equal(viewStep('services', 'services', true), 'stay');
  assert.equal(viewStep('home', 'services', false), 'push');
  assert.equal(viewStep('home', 'alerts', false), 'push');
  assert.equal(viewStep('services', 'alerts', true), 'replace');
  assert.equal(viewStep('alerts', 'services', false), 'replace');
  assert.equal(viewStep('alerts', 'home', true), 'back');
  // entered by hash from another page: there is no Home entry to go back to
  assert.equal(viewStep('services', 'home', false), 'reset');
});

test('score: name prefix beats a word prefix beats text beats letters in order; shorter names first', () => {
  const s = (name: string, q: string, hay = name.toLowerCase()) => score(hay, name, q);
  assert.ok(s('Proxmox VE', 'pro') > s('Proxmox Backup Server', 'pro'));
  assert.ok(s('Proxmox VE', 'pro') > s('AdGuard Home', 'home'));
  assert.equal(s('AdGuard Home', 'home'), 80);
  assert.equal(s('FRITZ!Box', 'box'), 80);
  assert.equal(score('traefik traefik.home.arpa management', 'Traefik', 'arpa'), 60);
  assert.equal(s('Proxmox VE', 'pxm'), 30);
  assert.equal(s('Proxmox VE', 'xyz'), -1);
  assert.equal(s('Proxmox VE', 'mxp'), -1);
});

test('grouped: groups in the order they first appear, rows in theirs', () => {
  const rows = [{ group: 'pve', n: 1 }, { group: 'omv', n: 2 }, { group: 'pve', n: 3 }];
  assert.deepEqual(grouped(rows), [{ name: 'pve', rows: [rows[0], rows[2]] }, { name: 'omv', rows: [rows[1]] }]);
  assert.deepEqual(grouped([]), []);
});

test('moved: first and last reading over the hours the trend covers; nothing from fewer than two readings', () => {
  const now = 100 * 3_600_000;
  assert.deepEqual(moved({ values: [61, null, 62.2], from: now - 24 * 3_600_000 }, '%', now), { delta: 62.2 - 61, text: '24 h: 61.0% → 62.2% (+1.2)' });
  assert.equal(moved({ values: [70, 68.5], from: now - 20 * 60_000 }, '%', now)?.text, '1 h: 70.0% → 68.5% (−1.5)');
  assert.equal(moved({ values: [null, 5], from: 0 }, '%', now), null);
  assert.equal(moved(null, '%', now), null);
});
