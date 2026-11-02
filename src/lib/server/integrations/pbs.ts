// Proxmox Backup Server — token auth (username = USER@REALM!TOKENID, password = secret).
// Backup freshness needs Datastore.Audit on the datastore; usage works with homepage's permissions.
// Removable datastores (PBS 3.3+, mount-status other than "nonremovable") are an offsite disk that is plugged
// in now and then: detached is normal, they only alert after offsiteMaxDetachedDays, and backup freshness skips them.
import { trimUrl } from '../http.ts';
import { card, fmtPair, fmtDuration, fmtPct, pct } from '../format.ts';
import { fromAttributes, isVirtual, kindOf, slowly, toDrive } from './smart.ts';
import type { SmartAttribute } from './smart.ts';
import type { Alert, Drive, Kv, SmartReading, Stat, StorageRow, UsageRow, WidgetEvent, Context, Widget, WidgetResult } from '$lib/types';

/** Every PBS API answer wraps its payload in `data`. */
export interface PbsResponse<T> {
  data: T;
}

/** A datastore in /status/datastore-usage; a detached removable one has no sizes. */
export interface PbsDatastoreUsage {
  store: string;
  /** PBS 3.3+: "nonremovable", or "mounted" / "notmounted" for a removable datastore */
  'mount-status'?: string;
  total?: number;
  used?: number;
  avail?: number;
}

/** A backup group in /admin/datastore/{store}/groups. */
export interface PbsBackupGroup {
  'backup-type': string;
  'backup-id': string;
  /** seconds since the epoch */
  'last-backup': number;
  comment?: string;
}

/** A disk in /nodes/localhost/disks/list. */
export interface PbsDisk {
  name: string;
  devpath?: string;
  model?: string | null;
  serial: string | null;
  vendor?: string | null;
  size: number;
  'disk-type'?: string;
  status?: string;
  wearout?: number | null;
  rpm?: number | null;
  used?: string;
}

/** /nodes/localhost/disks/smart: attributes for ATA, named values for NVMe. */
export interface PbsDiskSmart {
  status?: string;
  wearout?: number | null;
  attributes?: SmartAttribute[];
}

/** When a removable datastore was first and last seen attached, kept in kv. */
interface Attached {
  first: number;
  last: number | null;
  pct?: number | null;
}

type Mounted = PbsDatastoreUsage & { total: number; used: number };
const mounted = (s: PbsDatastoreUsage): s is Mounted => (s.total ?? 0) > 0;

const usageRow = (name: string, s: Mounted): UsageRow => ({ name, used: s.used, total: s.total, pct: pct(s.used, s.total), sub: fmtPair(s.used, s.total), source: 'pbs', metric: `storage.pbs.${s.store}` });
const removable = (s: PbsDatastoreUsage) => s['mount-status'] != null && s['mount-status'] !== 'nonremovable';

/**
 * Row and alert for a removable store; remembers when it was last seen attached (survives restarts).
 */
function removableStatus(s: PbsDatastoreUsage, now: number, maxDays: number, kv: Kv): { row: StorageRow; alert?: Alert | null } {
  const key = `pbs.attached.${s.store}`;
  const stored = kv.get<Attached>(key);
  const seen: Attached = stored ?? { first: now, last: null };
  if (mounted(s)) {
    kv.set(key, { ...seen, last: now, pct: pct(s.used, s.total) });
    return { row: usageRow(`${s.store} · removable`, s) };
  }
  if (!stored) kv.set(key, seen);
  const age = now - (seen.last ?? seen.first);
  return {
    // short enough to share the line with the name; the bar keeps how full the disk was when last attached
    row: { name: `${s.store} · removable`, offline: true, sub: seen.last ? `detached ${fmtDuration(age)}` : 'never attached', pct: seen.pct ?? null, source: 'pbs', metric: `storage.pbs.${s.store}` },
    alert: age > maxDays * 86_400_000 ? { sev: 'info', key: `detached-${s.store}`, title: `${s.store} detached for ${fmtDuration(age)}`, detail: 'Plug in the offsite disk to refresh its copy' } : null
  };
}

/**
 * Disks passed into the PBS VM, e.g. the removable offsite disk while it is plugged in; its own virtual disks are skipped.
 * Needs Sys.Audit (in the Audit role on /). PBS reports NVMe SMART as named attributes, which fromAttributes reads too.
 */
async function pbsDrives(ctx: Context, base: string, opts: object): Promise<Drive[]> {
  const url = `${base}/nodes/localhost/disks`;
  const list = (await ctx.getJson<PbsResponse<PbsDisk[]>>(`${url}/list`, opts)).data ?? [];
  return Promise.all(list.filter((d) => !isVirtual(d)).map(async (d) => {
    let reading: SmartReading | null = null;
    try { reading = fromAttributes((await ctx.getJson<PbsResponse<PbsDiskSmart>>(`${url}/smart?disk=${encodeURIComponent(d.name)}`, opts)).data?.attributes ?? []); } catch { /* status and wearout from the list still show */ }
    return toDrive({ model: d.model ?? d.name, serial: d.serial, kind: kindOf(d['disk-type'], d.rpm), size: d.size, status: d.status, wearout: d.wearout, smart: reading });
  }));
}

/** Backups that landed since the last reported event: group key → label, the stores they went to, the newest (PBS seconds). */
interface BackupBatch {
  guests: Record<string, string>;
  stores: string[];
  last: number;
}

/** A job run's backups land minutes apart; this long without a new one ends the run. */
const BATCH_QUIET_MS = 15 * 60_000;

type Group = PbsBackupGroup & { store: string };

/** A host backup (proxmox-backup-client on a machine), as opposed to a guest's (vzdump of a VM or container). */
const isHost = (g: PbsBackupGroup) => g['backup-type'] === 'host';

/** The guest's Proxmox name, else the group's comment, else "VM 101" / "CT 105" (a host backup's id is its hostname). */
function guestLabel(g: PbsBackupGroup, guests: Record<string, string> | null): string {
  const id = String(g['backup-id']);
  const name = (guests && Object.hasOwn(guests, id) ? guests[id] : '') || g.comment || '';
  return name || (isHost(g) ? id : `${g['backup-type'].toUpperCase()} ${id}`);
}

/** "web, db, dns and 3 more · main"; a single store, or several joined. */
function batchDetail(b: BackupBatch): string {
  const names = Object.values(b.guests).sort((x, y) => x.localeCompare(y));
  const shown = names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  return `${shown} · ${b.stores.sort().join(', ')}`;
}

/**
 * New backups since the last poll, as at most one event per kind (guests, hosts): a batch collects them (durably, so
 * backups made during a restart count) and is reported once none has landed for BATCH_QUIET_MS, at its last backup's time.
 * Each group is compared with its own last seen backup, not with the newest of all: PBS dates a backup by its start, so
 * a long guest backup that started before a host backup but finished after it would otherwise never be reported.
 * Groups that weren't read (missing permission, API error) keep their last seen backup.
 */
function backupEvents(ctx: Context, base: string, groups: Group[], guests: Record<string, string> | null, complete: boolean): WidgetEvent[] {
  const seenKey = `pbs.seen.${base}`;
  const stored = ctx.kv.get<Record<string, number>>(seenKey);
  // before the first poll (or an upgrade from the single high-water mark): what is there now is the baseline
  const legacy = stored ? null : ctx.kv.get<number>(`pbs.latest.${base}`);
  const keyOf = (g: Group) => `${g.store}/${g['backup-type']}/${g['backup-id']}`;
  // a store read for the first time (just added to the widget) is a baseline too; a new group in a known store is new
  const known = new Set(Object.keys(stored ?? {}).map((k) => k.split('/')[0]));
  const prevOf = (g: Group) => (stored ? (known.has(g.store) ? (stored[keyOf(g)] ?? 0) : g['last-backup']) : (legacy ?? g['last-backup']));
  const fresh = groups.filter((g) => g['last-backup'] > prevOf(g));

  const events: WidgetEvent[] = [];
  for (const [kind, title] of [['guest', 'Backups completed'], ['host', 'Host backups completed']] as const) {
    const batchKey = kind === 'guest' ? `pbs.batch.${base}` : `pbs.batch.host.${base}`;
    const batch = ctx.kv.get<BackupBatch>(batchKey) ?? { guests: {}, stores: [], last: 0 };
    const mine = fresh.filter((g) => isHost(g) === (kind === 'host'));
    for (const g of mine) {
      batch.guests[`${g['backup-type']}/${g['backup-id']}`] = guestLabel(g, guests);
      if (!batch.stores.includes(g.store)) batch.stores.push(g.store);
      batch.last = Math.max(batch.last, g['last-backup']);
    }
    if (batch.last && ctx.now - batch.last * 1000 >= BATCH_QUIET_MS) {
      events.push({ sev: 'ok', title, detail: batchDetail(batch), ts: batch.last * 1000 });
      ctx.kv.set(batchKey, null);
    } else if (mine.length) ctx.kv.set(batchKey, batch);
  }

  if (groups.length) {
    // every store read: forget deleted groups; otherwise keep what the unread stores had
    const seen: Record<string, number> = complete ? {} : { ...stored };
    for (const g of groups) seen[keyOf(g)] = g['last-backup'];
    ctx.kv.set(seenKey, seen);
    if (legacy != null) ctx.kv.set(`pbs.latest.${base}`, null);
  }
  return events;
}

export async function collect(w: Widget, ctx: Context): Promise<WidgetResult> {
  const base = trimUrl(w.url) + '/api2/json';
  const opts = { headers: { Authorization: `PBSAPIToken=${w.username}:${w.password}` }, insecure: ctx.insecure };
  const { data: usage } = await ctx.getJson<PbsResponse<PbsDatastoreUsage[]>>(`${base}/status/datastore-usage`, opts);
  const wanted = w.datastore == null ? null : [w.datastore].flat();
  const selected = usage.filter((s) => (wanted ? wanted.includes(s.store) : true));
  // freshness and the widget's stats are about the regular stores
  const stores = selected.filter((s): s is Mounted => !removable(s) && mounted(s));
  const now = ctx.now;
  const alerts: Alert[] = [];
  const regular = stores.map((s) => usageRow(`${s.store} · backups`, s));
  const storage: StorageRow[] = [...regular];
  for (const s of selected.filter(removable)) {
    const { row, alert } = removableStatus(s, now, ctx.settings.thresholds.offsiteMaxDetachedDays, ctx.kv);
    storage.push(row);
    if (alert) alerts.push(alert);
  }
  for (const s of selected.filter(mounted)) ctx.metric(`storage.pbs.${s.store}`, pct(s.used, s.total));

  const maxAge = ctx.settings.thresholds.backupMaxAgeHours * 3600_000;
  const groups: Group[] = [];
  let freshnessError: string | null = null;
  for (const s of stores) {
    try {
      const { data } = await ctx.getJson<PbsResponse<PbsBackupGroup[]>>(`${base}/admin/datastore/${encodeURIComponent(s.store)}/groups`, opts);
      groups.push(...data.map((g) => ({ ...g, store: s.store })));
    } catch (e) {
      // getJson throws an Error with the HTTP status (http.ts)
      const err = e as Error & { status?: number };
      freshnessError = err.status === 403 ? 'Token needs Datastore.Audit for backup freshness' : err.message;
    }
  }

  // A guest backed up to several stores is as fresh as its latest backup in any of them.
  const latestOf = new Map<string, Group>();
  for (const g of groups) {
    const k = `${g['backup-type']}/${g['backup-id']}`;
    if (!latestOf.has(k) || g['last-backup'] > (latestOf.get(k) as PbsBackupGroup)['last-backup']) latestOf.set(k, g);
  }
  // Only judge groups that still matter: guests that exist in PVE, or (without PVE data) backed up in the last 14 days.
  const guests = ctx.shared.guests ? Object.assign({}, ...Object.values(ctx.shared.guests)) as Record<string, string> : null;
  const relevant = [...latestOf.values()].filter((g) =>
    guests ? isHost(g) || Object.hasOwn(guests, String(g['backup-id'])) : now - g['last-backup'] * 1000 < 14 * 86_400_000
  );
  let oldest: { age: number; name: string } | null = null;
  let hostOverdue = 0;
  for (const g of relevant) {
    const age = now - g['last-backup'] * 1000;
    const label = guestLabel(g, guests);
    if (!oldest || age > oldest.age) oldest = { age, name: label };
    if (age > maxAge) {
      if (isHost(g)) hostOverdue++;
      const what = isHost(g) ? `host ${label}` : /^(VM|CT) /.test(label) ? label : `${g['backup-id']} ${label}`;
      alerts.push({ sev: 'warn', key: `backup-${g['backup-id']}`, title: 'Backup overdue', detail: `${what} · last success ${fmtDuration(age)} ago` });
    }
  }

  const events = backupEvents(ctx, base, groups, guests, !freshnessError);

  // guests (vzdump) and hosts (proxmox-backup-client) run on their own schedules, so they are reported apart
  const newest = (gs: PbsBackupGroup[]) => Math.max(0, ...gs.map((g) => g['last-backup']));
  const guestLatest = newest(groups.filter((g) => !isHost(g)));
  const hostLatest = newest(groups.filter(isHost));
  const hostGroups = relevant.filter(isHost);
  const hostNames = (hostGroups.length ? hostGroups : [...latestOf.values()].filter(isHost)).map((g) => guestLabel(g, guests)).sort();
  const guestCount = relevant.filter((g) => !isHost(g)).length;

  const store = regular[0] ?? null;
  if (freshnessError) alerts.push({ sev: 'info', key: 'pbs-perm', title: 'Backup freshness unavailable', detail: freshnessError });

  const overdue = alerts.filter((a) => a.title === 'Backup overdue').length;
  // overdue backups only when there are any; the line starts with a capital
  const facts: [Stat, string][] = [];
  const cap = (t: string) => (facts.length ? t : t[0].toUpperCase() + t.slice(1));
  if (overdue) facts.push([{ k: 'overdue', v: String(overdue), level: 'warn' }, `${overdue} backup${overdue > 1 ? 's' : ''} overdue`]);
  if (guestLatest) {
    const ago = fmtDuration(now - guestLatest * 1000);
    facts.push([{ k: 'last backup', v: ago }, cap(`last backup ${ago} ago`)]);
  }
  if (store) facts.push([{ k: 'datastore', v: fmtPct(store.pct) }, cap(`store ${fmtPct(store.pct)}`)]);
  // after the store: the card's line is about the guests, the sheet shows all stats
  if (hostLatest) {
    const ago = fmtDuration(now - hostLatest * 1000);
    facts.push([{ k: 'host backup', v: ago }, cap(`host backup ${ago} ago`)]);
  }
  const groupCount = relevant.length || latestOf.size;
  if (groupCount) facts.push([{ k: 'groups', v: String(groupCount) }, cap(`${groupCount} group${groupCount > 1 ? 's' : ''}`)]);
  return {
    ...card(facts),
    alerts,
    events,
    storage,
    drives: (await slowly(ctx, 'drives', () => pbsDrives(ctx, base, opts))) ?? [],
    backups: {
      overdue, oldestAge: oldest?.age ?? null, oldestName: oldest?.name ?? null, known: relevant.length > 0,
      guests: guestCount, last: guestLatest ? guestLatest * 1000 : null, stores: stores.map((s) => s.store),
      hosts: hostNames, hostLast: hostLatest ? hostLatest * 1000 : null, hostOverdue
    }
  };
}
