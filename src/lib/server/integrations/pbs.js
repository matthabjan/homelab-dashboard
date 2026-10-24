// Proxmox Backup Server — token auth (username = USER@REALM!TOKENID, password = secret).
// Backup freshness needs Datastore.Audit on the datastore; usage works with homepage's permissions.
// Removable datastores (PBS 3.3+, mount-status other than "nonremovable") are an offsite disk that is plugged
// in now and then: detached is normal, they only alert after offsiteMaxDetachedDays, and backup freshness skips them.
import { trimUrl } from '../http.js';
import { fmtPair, fmtDuration, fmtPct, pct } from '../format.js';
import { fromAttributes, isVirtual, kindOf, slowly, toDrive } from './smart.js';
/** @import { Alert, Drive, StorageRow, UsageRow, WidgetEvent, Context, Widget, WidgetResult } from '$lib/types' */

/** @returns {UsageRow} */
const usageRow = (name, s) => ({ name, used: s.used, total: s.total, pct: pct(s.used, s.total), sub: fmtPair(s.used, s.total), source: 'pbs' });
const removable = (s) => s['mount-status'] != null && s['mount-status'] !== 'nonremovable';

/**
 * Row and alert for a removable store; remembers when it was last seen attached (survives restarts).
 * @returns {{ row: StorageRow, alert?: Alert | null }}
 */
function removableStatus(s, now, maxDays, kv) {
  const key = `pbs.attached.${s.store}`;
  const stored = kv.get(key);
  const seen = stored ?? { first: now, last: null };
  if (s.total > 0) {
    kv.set(key, { ...seen, last: now });
    return { row: usageRow(`${s.store} · removable`, s) };
  }
  if (!stored) kv.set(key, seen);
  const age = now - (seen.last ?? seen.first);
  return {
    row: { name: `${s.store} · removable`, offline: true, sub: seen.last ? `detached · last attached ${fmtDuration(age)} ago` : 'detached · never seen attached', source: 'pbs' },
    alert: age > maxDays * 86_400_000 ? { sev: 'info', key: `detached-${s.store}`, title: `${s.store} detached for ${fmtDuration(age)}`, detail: 'Plug in the offsite disk to refresh its copy' } : null
  };
}

/**
 * Disks passed into the PBS VM, e.g. the removable offsite disk while it is plugged in; its own virtual disks are skipped.
 * Needs Sys.Audit (in the Audit role on /). PBS reports NVMe SMART as named attributes, which fromAttributes reads too.
 * @param {Context} ctx @param {string} base @param {object} opts
 * @returns {Promise<Drive[]>}
 */
async function pbsDrives(ctx, base, opts) {
  const url = `${base}/nodes/localhost/disks`;
  const list = (await ctx.getJson(`${url}/list`, opts)).data ?? [];
  return Promise.all(list.filter((d) => !isVirtual(d)).map(async (d) => {
    let reading = null;
    try { reading = fromAttributes((await ctx.getJson(`${url}/smart?disk=${encodeURIComponent(d.name)}`, opts)).data?.attributes ?? []); } catch { /* status and wearout from the list still show */ }
    return toDrive({ model: d.model ?? d.name, serial: d.serial, kind: kindOf(d['disk-type'], d.rpm), size: d.size, status: d.status, wearout: d.wearout, smart: reading });
  }));
}

/**
 * @param {Widget} w
 * @param {Context} ctx
 * @returns {Promise<WidgetResult>}
 */
export async function collect(w, ctx) {
  const base = trimUrl(w.url) + '/api2/json';
  const opts = { headers: { Authorization: `PBSAPIToken=${w.username}:${w.password}` }, insecure: ctx.insecure };
  const { data: usage } = await ctx.getJson(`${base}/status/datastore-usage`, opts);
  const wanted = w.datastore == null ? null : [w.datastore].flat();
  const selected = usage.filter((s) => (wanted ? wanted.includes(s.store) : true));
  // freshness and the widget's stats are about the regular stores
  const stores = selected.filter((s) => !removable(s) && s.total > 0);
  const now = ctx.now;
  /** @type {Alert[]} */
  const alerts = [];
  const regular = stores.map((s) => usageRow(`${s.store} · backups`, s));
  /** @type {StorageRow[]} */
  const storage = [...regular];
  for (const s of selected.filter(removable)) {
    const { row, alert } = removableStatus(s, now, ctx.settings.thresholds.offsiteMaxDetachedDays, ctx.kv);
    storage.push(row);
    if (alert) alerts.push(alert);
  }
  for (const s of selected.filter((x) => x.total > 0)) ctx.metric(`storage.pbs.${s.store}`, pct(s.used, s.total));

  const maxAge = ctx.settings.thresholds.backupMaxAgeHours * 3600_000;
  /** @type {WidgetEvent[]} */
  const events = [];
  let groups = [];
  let freshnessError = null;
  for (const s of stores) {
    try {
      const { data } = await ctx.getJson(`${base}/admin/datastore/${encodeURIComponent(s.store)}/groups`, opts);
      groups.push(...data.map((g) => ({ ...g, store: s.store })));
    } catch (e) {
      freshnessError = e.status === 403 ? 'Token needs Datastore.Audit for backup freshness' : e.message;
    }
  }

  // Only judge groups that still matter: guests that exist in PVE, or (without PVE data) backed up in the last 14 days.
  const guestIds = ctx.shared.guestIds;
  const relevant = groups.filter((g) =>
    guestIds ? g['backup-type'] === 'host' || guestIds.has(String(g['backup-id'])) : now - g['last-backup'] * 1000 < 14 * 86_400_000
  );
  let oldest = null;
  for (const g of relevant) {
    const age = now - g['last-backup'] * 1000;
    const name = ctx.shared.guestNames?.[g['backup-id']] || g.comment || '';
    if (!oldest || age > oldest.age) oldest = { age, id: g['backup-id'], name };
    if (age > maxAge) {
      alerts.push({ sev: 'warn', key: `backup-${g['backup-id']}`, title: 'Backup overdue', detail: `${g['backup-id']} ${name} · last success ${fmtDuration(age)} ago` });
    }
  }

  // Event when new backups landed since the last poll
  const latest = Math.max(0, ...groups.map((g) => g['last-backup']));
  const prevLatest = ctx.state.latest ?? latest;
  if (latest > prevLatest) {
    const fresh = groups.filter((g) => g['last-backup'] > prevLatest);
    events.push({ sev: 'ok', title: 'Backups completed', detail: `${fresh.length} ${fresh.length === 1 ? 'guest' : 'guests'} · ${stores.map((s) => s.store).join(', ')}` });
  }
  ctx.state.latest = latest;

  const store = regular[0] ?? null;
  const stats = [
    { k: 'oldest backup', v: oldest ? fmtDuration(oldest.age) : '—', level: oldest && oldest.age > maxAge ? 'warn' : null },
    { k: 'datastore', v: fmtPct(store?.pct) },
    { k: 'groups', v: String(relevant.length || groups.length || '—') }
  ];
  if (freshnessError) alerts.push({ sev: 'info', key: 'pbs-perm', title: 'Backup freshness unavailable', detail: freshnessError });

  const overdue = alerts.filter((a) => a.title === 'Backup overdue').length;
  return {
    stats,
    line: overdue ? `${overdue} backup${overdue > 1 ? 's' : ''} overdue` : oldest ? `Last backup ${fmtDuration(now - latest * 1000)} ago · store ${fmtPct(store?.pct)}` : store ? `Store ${fmtPct(store.pct)}` : 'Online',
    alerts,
    events,
    storage,
    drives: (await slowly(ctx, 'drives', () => pbsDrives(ctx, base, opts))) ?? [],
    backups: { overdue, oldestAge: oldest?.age ?? null, known: relevant.length > 0 }
  };
}
