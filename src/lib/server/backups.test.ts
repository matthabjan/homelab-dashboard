// The Backups area through its interface: PBS results and jobs in; the sheet's figures and rows and the card's row out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backups, days } from './backups.ts';
import type { PbsSource } from './backups.ts';
import type { Job, PbsBackups } from '$lib/types';

const H = 3600_000;
const now = 100 * 24 * H;

const pbs = (name: string, b: Partial<PbsBackups> = {}): PbsSource => ({
  id: `g-${name.toLowerCase()}`, name,
  backups: { known: true, guests: 3, guestOverdue: 0, last: now - 6 * H, hosts: [], hostOverdue: 0, hostLast: null, oldestAge: 20 * H, oldestName: 'web', stores: ['main'], overdueSev: 'warn', ...b }
});
/** A daily job; `ago` is when it last ran. */
const job = (name: string, state: Job['state'], ago: number | null, extra: Partial<Job> = {}): Job => {
  const lastOk = ago == null ? null : now - ago;
  const [status, level]: [string, Job['level']] = state === 'down' ? ['overdue', 'crit'] : state === 'pending' ? ['waiting for its first run', 'none'] : ['on schedule', 'ok'];
  return { id: `j-${name.toLowerCase()}`, name, group: 'Jobs', href: null, description: '', every: 24 * H, grace: H, lastOk, lastFail: null, due: (lastOk ?? now) + 24 * H, state, failed: false, backup: true, status, level, ...extra };
};

test('overdue: PBS servers added up with the late backup jobs; a job that makes no backup is named and red, not counted', () => {
  const { sheet, panel } = backups([pbs('A', { guestOverdue: 1 }), pbs('B', { guestOverdue: 1, hostOverdue: 1, hosts: ['nas'] })], [job('Restic', 'down', 26 * H), job('Verify', 'down', 26 * H, { backup: false })], now);
  assert.deepEqual([sheet.overdue, sheet.level], [4, 'crit'], 'the late restic job is critical, as its alert is');
  assert.deepEqual(panel, { id: 'backups', label: 'Backups', value: '4 overdue', sub: 'Restic, Verify, 3 PBS backups', level: 'crit' });

  const verifyOnly = backups([pbs('A')], [job('Verify', 'down', 26 * H, { backup: false })], now);
  assert.deepEqual([verifyOnly.sheet.overdue, verifyOnly.sheet.level], [0, 'none']);
  assert.deepEqual(verifyOnly.panel, { id: 'backups', label: 'Backups', value: 'All current', sub: 'Verify', level: 'crit' });

  const pbsOnly = backups([pbs('A', { guestOverdue: 2 })], [], now);
  assert.deepEqual([pbsOnly.sheet.level, pbsOnly.panel?.level, pbsOnly.panel?.sub], ['warn', 'warn', '2 PBS backups'], 'as bad as PBS raises them');
});

test('oldest backup: the oldest of every PBS server and every backup job that ran, named after what it is', () => {
  const oldest = (p: PbsSource[], jobs: Job[]) => { const { sheet } = backups(p, jobs, now); return [sheet.oldestAge, sheet.oldestName]; };
  assert.deepEqual(oldest([pbs('A', { oldestAge: 30 * H, oldestName: 'web' }), pbs('B', { oldestAge: 50 * H, oldestName: 'db' })], []), [50 * H, 'db']);
  assert.deepEqual(oldest([pbs('A', { oldestAge: 30 * H })], [job('Restic', 'down', 31 * H), job('Borg', 'up', 6 * H)]), [31 * H, 'Restic']);
  assert.deepEqual(oldest([pbs('A', { oldestAge: 30 * H })], [job('Borg', 'up', 6 * H)]), [30 * H, 'web'], 'PBS keeps the name of its oldest');
  assert.deepEqual(oldest([], [job('Borg', 'up', 6 * H)]), [6 * H, 'Borg']);
  assert.deepEqual(oldest([pbs('A', { oldestAge: 30 * H })], [job('Borg', 'pending', null)]), [30 * H, 'web'], 'a job that never ran adds nothing yet');
  assert.deepEqual(oldest([pbs('A', { oldestAge: 90 * H })], [job('Sync', 'up', 2 * H, { backup: false })]), [90 * H, 'web'], 'nor does one that makes no backup');
});

test('rows: each PBS server\'s guests and hosts apart, then the jobs by when they are due', () => {
  const four = ['a', 'b', 'c', 'd'];
  const { sheet } = backups([
    pbs('PBS', { stores: ['main', 'offsite'], guests: 1, guestOverdue: 1, hosts: four, hostOverdue: 0, hostLast: now - H }),
    pbs('Hosts only', { guests: 0, hosts: ['nas'], stores: [] })
  ], [job('Late', 'up', 20 * H), job('Soon', 'up', 23 * H), job('New', 'pending', null)], now);
  assert.deepEqual(sheet.rows.map((r) => [r.title, r.detail, r.state, r.level, r.source ?? r.due]), [
    ['Guest backups · main, offsite', '1 guest', '1 overdue', 'warn', 'PBS'],
    ['Host backups · main, offsite', 'a, b and 2 more', 'on schedule', 'ok', 'PBS'],
    ['Host backups', 'nas', 'on schedule', 'ok', 'Hosts only'],
    ['Soon', 'every 1 d', 'on schedule', 'ok', now + H],
    ['Late', 'every 1 d', 'on schedule', 'ok', now + 4 * H],
    ['New', 'every 1 d', 'waiting for its first run', 'none', now + 24 * H]
  ]);
});

test('card: with nothing late the next job due, else the oldest backup; nothing to show is no row', () => {
  assert.equal(backups([pbs('A')], [job('Restic', 'up', 18 * H)], now).panel?.sub, 'next: Restic in 6 h');
  assert.deepEqual(backups([pbs('A', { oldestAge: 20 * H, oldestName: 'web' })], [], now).panel, { id: 'backups', label: 'Backups', value: 'All current', sub: 'oldest backup 20 h · web', level: 'none' });
  assert.equal(backups([pbs('A', { known: false })], [], now).panel, null, 'a PBS server that judged no group');
  assert.deepEqual(backups([pbs('A', { known: false })], [], now).sheet.rows, []);
});

test('days: a day each, oldest first; a job found late or a critical report makes the day critical, good news alone ok', () => {
  const D = 24 * H;
  const at = (daysAgo: number) => now - daysAgo * D + H;
  const history = {
    // day 0 (a week ago): checked, all on time; day 3: one check found a job late; day 6 (today): on time
    checks: [{ b: 0, n: 48, fails: 0 }, { b: 3, n: 48, fails: 1 }, { b: 6, n: 700, fails: 0 }, { b: 9, n: 5, fails: 5 }],
    // day 1: completed (a warning or failure among the events is a check of the service, not a backup); day 2: a note
    // is no record; day 6: completed
    events: [{ ts: at(6), sev: 'ok' as const }, { ts: at(6), sev: 'warn' as const }, { ts: at(5), sev: 'info' as const }, { ts: at(1), sev: 'ok' as const }, { ts: now - 9 * D, sev: 'crit' as const }]
  };
  assert.deepEqual(days(history, now), ['ok', 'ok', 'none', 'crit', 'none', 'none', 'ok']);
  assert.deepEqual(backups([], [], now).sheet.days, ['none', 'none', 'none', 'none', 'none', 'none', 'none'], 'no record without history');
  assert.deepEqual(backups([pbs('A')], [], now, history).sheet.days[3], 'crit', 'the sheet carries them');
  // the PBS server itself was unreachable for a moment today, and came back: its backups are fine
  const blip = { checks: [{ b: 6, n: 700, fails: 0 }], events: [{ ts: at(0) - 2 * H, sev: 'crit' as const, outage: at(0) - 2 * H }, { ts: at(0) - H, sev: 'ok' as const, outage: at(0) - 2 * H }] };
  assert.equal(days(blip, now)[6], 'ok', 'an outage of the backup server is not a failed backup');
  // the same outage written before outages were marked: no `outage`, still no failed backup
  const old = { checks: [{ b: 6, n: 700, fails: 0 }], events: [{ ts: at(0) - 2 * H, sev: 'crit' as const, outage: null }] };
  assert.equal(days(old, now)[6], 'ok', 'an unmarked went down from an older database is not a failed backup either');
});
