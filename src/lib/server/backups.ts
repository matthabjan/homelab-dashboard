// The Backups area, said once for the infrastructure card's row, the Backups sheet and the verdict. Each PBS group and
// each job is judged where it is read (pbs.ts against backupMaxAgeHours, check.ts for heartbeats); this adds them up.
import { ago, until } from '../ago.ts';
import { plural, worst } from './format.ts';
import type { BackupRow, Backups, InfraPanel, Job, Level, PbsBackups, Severity } from '$lib/types';

/** One PBS service's backups. */
export interface PbsSource {
  id: string;
  name: string;
  backups: PbsBackups;
}

const overdueOf = (b: PbsBackups) => b.guestOverdue + b.hostOverdue;

/** A PBS server's guest backups as one row, its host backups as another (they run on their own schedules). */
function pbsRows({ id, name, backups: b }: PbsSource): BackupRow[] {
  const stores = b.stores.length ? ` · ${b.stores.join(', ')}` : '';
  const row = (title: string, detail: string, last: number | null, overdue: number): BackupRow => ({
    id, title: title + stores, detail, last, due: null, state: overdue ? `${overdue} overdue` : 'on schedule', level: overdue ? b.overdueSev : 'ok', source: name
  });
  const hosts = b.hosts.length > 3 ? `${b.hosts.slice(0, 2).join(', ')} and ${b.hosts.length - 2} more` : b.hosts.join(', ');
  return [
    ...(b.guests || !b.hosts.length ? [row('Guest backups', plural(b.guests, 'guest'), b.last, b.guestOverdue)] : []),
    ...(b.hosts.length ? [row('Host backups', hosts, b.hostLast, b.hostOverdue)] : [])
  ];
}

const jobRow = (j: Job): BackupRow => ({ id: j.id, title: j.name, detail: `every ${ago(0, j.every)}`, last: j.lastOk, due: j.due, state: j.status, level: j.level, source: null });

/**
 * The card's row. Its figure counts backups only, as the sheet does: PBS and the jobs marked `backup: true`. Any late
 * job is named, and the row is as bad as what is raised: a late job is critical, an overdue PBS backup as PBS says.
 * With nothing late: the next job due, else the oldest backup.
 */
function panel(sheet: Backups, pbs: PbsSource[], jobs: Job[], now: number): InfraPanel {
  const late = jobs.filter((j) => j.state === 'down');
  const behind = pbs.filter((p) => overdueOf(p.backups));
  const pbsOverdue = behind.reduce((n, p) => n + overdueOf(p.backups), 0);
  const next = [...jobs].sort((a, b) => a.due - b.due)[0];
  const sub = sheet.overdue || late.length
    ? [...late.map((j) => j.name), pbsOverdue && plural(pbsOverdue, 'PBS backup')].filter(Boolean).join(', ')
    : next ? `next: ${next.name} ${until(next.due, now)}`
    : sheet.oldestAge != null ? `oldest backup ${ago(now - sheet.oldestAge, now)}${sheet.oldestName ? ` · ${sheet.oldestName}` : ''}`
    : '';
  return {
    id: 'backups', label: 'Backups', value: sheet.overdue ? `${sheet.overdue} overdue` : 'All current', sub,
    level: worst([...late.map((j) => j.level), ...behind.map((p) => p.backups.overdueSev)])
  };
}

const DAY = 86_400_000;
export const DAYS = 7;

/**
 * What was recorded about backups over the last `DAYS` days: the backup jobs' checks per day (`b` counts days from
 * `now - DAYS` days; `fails` is how many found a job late) and what the backup services reported.
 */
export interface BackupHistory {
  checks: { b: number; n: number; fails: number }[];
  events: { ts: number; sev: Severity | 'ok' }[];
}

/** A day each, oldest first: critical when a job was found late or something critical was reported, and so on down. */
export function days(history: BackupHistory, now: number): Backups['days'] {
  const rank = { none: 0, ok: 1, warn: 2, crit: 3 } as const;
  const out: (Level | 'none')[] = Array.from({ length: DAYS }, () => 'none');
  const put = (b: number, level: Level) => { if (b >= 0 && b < DAYS && rank[level] > rank[out[b]]) out[b] = level; };
  for (const c of history.checks) if (c.n) put(c.b, c.fails ? 'crit' : 'ok');
  for (const e of history.events) if (e.sev !== 'info') put(Math.floor((e.ts - (now - DAYS * DAY)) / DAY), e.sev);
  return out;
}

/**
 * The Backups sheet and the card's row from every PBS widget and every job. Only PBS servers that judged a group count;
 * a job that never ran adds nothing yet. The panel is null when there is nothing to show.
 */
export function backups(pbs: PbsSource[], jobs: Job[], now: number, history: BackupHistory = { checks: [], events: [] }): { sheet: Backups; panel: InfraPanel | null } {
  const known = pbs.filter((p) => p.backups.known);
  const ran = jobs.filter((j) => j.backup && j.state !== 'pending');
  const lateBackups = ran.filter((j) => j.state === 'down');
  const ages = [
    ...known.flatMap((p) => (p.backups.oldestAge != null ? [{ age: p.backups.oldestAge, name: p.backups.oldestName }] : [])),
    ...ran.flatMap((j) => (j.lastOk != null ? [{ age: now - j.lastOk, name: j.name }] : []))
  ];
  const oldest = ages.reduce<(typeof ages)[number] | null>((o, a) => (!o || a.age > o.age ? a : o), null);
  const sheet: Backups = {
    overdue: known.reduce((n, p) => n + overdueOf(p.backups), 0) + lateBackups.length,
    level: worst([...known.filter((p) => overdueOf(p.backups)).map((p) => p.backups.overdueSev), ...lateBackups.map((j) => j.level)]),
    oldestAge: oldest?.age ?? null,
    oldestName: oldest?.name ?? null,
    rows: [...known.flatMap(pbsRows), ...[...jobs].sort((a, b) => a.due - b.due).map(jobRow)],
    days: days(history, now)
  };
  return { sheet, panel: known.length || jobs.length ? panel(sheet, known, jobs, now) : null };
}
