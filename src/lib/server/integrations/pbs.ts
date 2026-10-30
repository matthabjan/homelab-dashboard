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

const usageRow = (name: string, s: Mounted): UsageRow => ({ name, used: s.used, total: s.total, pct: pct(s.used, s.total), sub: fmtPair(s.used, s.total), source: 'pbs' });
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
    row: { name: `${s.store} · removable`, offline: true, sub: seen.last ? `detached ${fmtDuration(age)}` : 'never attached', pct: seen.pct ?? null, source: 'pbs' },
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
  const events: WidgetEvent[] = [];
  const groups: (PbsBackupGroup & { store: string })[] = [];
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
  const latestOf = new Map<string, PbsBackupGroup & { store: string }>();
  for (const g of groups) {
    const k = `${g['backup-type']}/${g['backup-id']}`;
    if (!latestOf.has(k) || g['last-backup'] > (latestOf.get(k) as PbsBackupGroup)['last-backup']) latestOf.set(k, g);
  }
  // Only judge groups that still matter: guests that exist in PVE, or (without PVE data) backed up in the last 14 days.
  const guests = ctx.shared.guests ? Object.assign({}, ...Object.values(ctx.shared.guests)) as Record<string, string> : null;
  const relevant = [...latestOf.values()].filter((g) =>
    guests ? g['backup-type'] === 'host' || Object.hasOwn(guests, String(g['backup-id'])) : now - g['last-backup'] * 1000 < 14 * 86_400_000
  );
  let oldest: { age: number; id: string; name: string } | null = null;
  for (const g of relevant) {
    const age = now - g['last-backup'] * 1000;
    const name = (guests && Object.hasOwn(guests, g['backup-id']) ? guests[g['backup-id']] : '') || g.comment || '';
    if (!oldest || age > oldest.age) oldest = { age, id: g['backup-id'], name };
    if (age > maxAge) {
      alerts.push({ sev: 'warn', key: `backup-${g['backup-id']}`, title: 'Backup overdue', detail: `${g['backup-id']} ${name} · last success ${fmtDuration(age)} ago` });
    }
  }

  // Event when new backups landed since the last poll; the baseline is durable so backups made during a restart count.
  // No groups (missing permission, API error) leaves it alone, so the next good poll doesn't report every backup as new.
  const latest = Math.max(0, ...groups.map((g) => g['last-backup']));
  if (latest) {
    const key = `pbs.latest.${base}`;
    const stored = ctx.kv.get<number>(key);
    const prevLatest = stored ?? latest;
    if (latest > prevLatest) {
      const fresh = groups.filter((g) => g['last-backup'] > prevLatest);
      events.push({ sev: 'ok', title: 'Backups completed', detail: `${fresh.length} ${fresh.length === 1 ? 'guest' : 'guests'} · ${stores.map((s) => s.store).join(', ')}` });
    }
    if (latest !== stored) ctx.kv.set(key, latest);
  }

  const store = regular[0] ?? null;
  if (freshnessError) alerts.push({ sev: 'info', key: 'pbs-perm', title: 'Backup freshness unavailable', detail: freshnessError });

  const overdue = alerts.filter((a) => a.title === 'Backup overdue').length;
  // overdue backups only when there are any; the line starts with a capital
  const facts: [Stat, string][] = [];
  if (overdue) facts.push([{ k: 'overdue', v: String(overdue), level: 'warn' }, `${overdue} backup${overdue > 1 ? 's' : ''} overdue`]);
  if (latest) {
    const ago = fmtDuration(now - latest * 1000);
    facts.push([{ k: 'last backup', v: ago }, `${facts.length ? 'last' : 'Last'} backup ${ago} ago`]);
  }
  if (store) facts.push([{ k: 'datastore', v: fmtPct(store.pct) }, `${facts.length ? 'store' : 'Store'} ${fmtPct(store.pct)}`]);
  const groupCount = relevant.length || latestOf.size;
  if (groupCount) facts.push([{ k: 'groups', v: String(groupCount) }, `${groupCount} group${groupCount > 1 ? 's' : ''}`]);
  return {
    ...card(facts),
    alerts,
    events,
    storage,
    drives: (await slowly(ctx, 'drives', () => pbsDrives(ctx, base, opts))) ?? [],
    backups: { overdue, oldestAge: oldest?.age ?? null, known: relevant.length > 0 }
  };
}
