// Proxmox Backup Server — token auth (username = USER@REALM!TOKENID, password = secret).
// Backup freshness needs Datastore.Audit on the datastore; usage works with homepage's permissions.
import { getJson, trimUrl } from '../http.js';
import { fmtPair, fmtDuration, pct } from '../format.js';

export async function collect(w, ctx) {
  const base = trimUrl(w.url) + '/api2/json';
  const opts = { headers: { Authorization: `PBSAPIToken=${w.username}:${w.password}` }, insecure: ctx.insecure };
  const { data: usage } = await getJson(`${base}/status/datastore-usage`, opts);
  const stores = usage.filter((s) => (w.datastore ? s.store === w.datastore : true) && s.total > 0);
  const storage = stores.map((s) => ({ name: `${s.store} · backups`, used: s.used, total: s.total, pct: pct(s.used, s.total), sub: fmtPair(s.used, s.total), source: 'pbs' }));
  for (const s of stores) ctx.metric(`storage.pbs.${s.store}`, pct(s.used, s.total));

  const now = ctx.now;
  const maxAge = ctx.settings.thresholds.backupMaxAgeHours * 3600_000;
  const alerts = [];
  const events = [];
  let groups = [];
  let freshnessError = null;
  for (const s of stores) {
    try {
      const { data } = await getJson(`${base}/admin/datastore/${encodeURIComponent(s.store)}/groups`, opts);
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

  const store = storage[0];
  const stats = [
    { k: 'oldest backup', v: oldest ? fmtDuration(oldest.age) : '—', level: oldest && oldest.age > maxAge ? 'warn' : null },
    { k: 'datastore', v: store ? `${Math.round(store.pct)}%` : '—' },
    { k: 'groups', v: String(relevant.length || groups.length || '—') }
  ];
  if (freshnessError) alerts.push({ sev: 'info', key: 'pbs-perm', title: 'Backup freshness unavailable', detail: freshnessError });

  const overdue = alerts.filter((a) => a.title === 'Backup overdue').length;
  return {
    stats,
    line: overdue ? `${overdue} backup${overdue > 1 ? 's' : ''} overdue` : oldest ? `Last backup ${fmtDuration(now - latest * 1000)} ago · store ${Math.round(store?.pct ?? 0)}%` : `Store ${Math.round(store?.pct ?? 0)}%`,
    alerts,
    events,
    storage,
    backups: { overdue, oldestAge: oldest?.age ?? null, known: relevant.length > 0 }
  };
}
