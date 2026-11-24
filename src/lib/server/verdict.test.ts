// The verdict through its interface: the tiles, the jobs and the closed attention in; the top card's sentence out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './verdict.ts';
import type { AttentionItem, Job, Tile } from '#lib/types';

const tile = (name: string, extra: Partial<Tile> = {}) => ({ id: name, name, level: 'ok', status: 'Up', check: 'http', cert: null, ...extra }) as Tile;
const job = (name: string, extra: Partial<Job> = {}) => ({ id: name, name, state: 'up', backup: true, ...extra }) as Job;
const calm = { headline: { level: 'ok' as const, tag: 'All good', title: 'Everything is fine.' }, needCount: 0, items: [] };
const base = { tiles: [], jobs: [], backupRows: 0, certWarnDays: 14 };

test('healthy: how many services are up, jobs counted apart', () => {
  const v = verdict({ ...base, tiles: [tile('A'), tile('B'), tile('Job', { check: 'heartbeat' })], jobs: [job('Job'), job('Sync')] }, calm);
  assert.deepEqual([v.level, v.title, v.sub, v.action], ['ok', 'All 2 services up', '2 backup jobs on schedule', null]);
});

test('healthy: one service is named; a job that makes no backup makes them "jobs"; a late one is counted out', () => {
  assert.equal(verdict({ ...base, tiles: [tile('Proxmox VE')] }, calm).title, 'Proxmox VE is up');
  assert.equal(verdict({ ...base, tiles: [tile('A')], jobs: [job('Backup'), job('Verify', { backup: false, state: 'down' })] }, calm).sub, '1 of 2 jobs on schedule');
});

test('healthy: a service still unknown is not counted; without services the headline stays', () => {
  assert.equal(verdict({ ...base, tiles: [tile('A'), tile('New', { level: 'unknown' })] }, calm).title, 'A is up');
  assert.equal(verdict(base, calm).title, 'Everything is fine');
});

test('healthy: backups without jobs are "current"; expiring certificates are counted', () => {
  const v = verdict({ ...base, backupRows: 2, tiles: [tile('A', { cert: { days: 9, selfSigned: false } }), tile('B', { cert: { days: 60, selfSigned: false } })] }, calm);
  assert.equal(v.sub, 'backups current · 1 certificate expiring');
});

test('one thing needs attention: that item, its detail, how many are up and the way to its service', () => {
  const top = { sev: 'crit', key: 'm|check', title: 'Music is down', detail: 'Connection refused', service: 'Music', href: 'https://music.home.arpa' } as AttentionItem;
  const att = { headline: { level: 'crit' as const, tag: 'Down', title: 'Music is down.' }, needCount: 1, items: [top] };
  const v = verdict({ ...base, tiles: [tile('A'), tile('Music', { level: 'crit', status: 'Down' })] }, att);
  assert.deepEqual(v, { level: 'crit', tag: 'Down', title: 'Music is down', sub: 'Connection refused · 1 of 2 services up', action: { label: 'Open Music', href: 'https://music.home.arpa' } });
  const config = verdict({ ...base, tiles: [tile('A')] }, { ...att, items: [{ ...top, detail: undefined, service: undefined, href: '/config#problems' } as unknown as AttentionItem] });
  assert.deepEqual([config.sub, config.action], ['1 of 1 services up', { label: 'Open it', href: '/config#problems' }]);
});

test('several things need attention: how many and how bad; the list names them, so no item and no action here', () => {
  const item = (sev: string, n: number) => ({ sev, key: `k${n}`, title: `Problem ${n}`, detail: 'why', service: 'Music', href: 'https://music.home.arpa' }) as AttentionItem;
  const head = { level: 'crit' as const, tag: '3 need attention', title: 'Problem 1.' };
  const tiles = [tile('A'), tile('Music', { level: 'crit', status: 'Down' })];
  const mixed = verdict({ ...base, tiles }, { headline: head, needCount: 3, items: [item('crit', 1), item('warn', 2), item('warn', 3), item('info', 4)] });
  assert.deepEqual(mixed, { level: 'crit', tag: '3 need attention', title: '3 things need attention', sub: '1 critical · 2 warnings · 1 of 2 services up', action: null });
  const warnings = verdict({ ...base, tiles: [tile('A')] }, { headline: { ...head, level: 'warn' }, needCount: 2, items: [item('warn', 1), item('warn', 2)] });
  assert.deepEqual([warnings.title, warnings.sub], ['2 things need attention', '2 warnings · 1 of 1 services up']);
  const crits = verdict({ ...base, tiles: [tile('A')] }, { headline: head, needCount: 2, items: [item('crit', 1), item('crit', 2)] });
  assert.equal(crits.sub, '2 critical · 1 of 1 services up');
});
