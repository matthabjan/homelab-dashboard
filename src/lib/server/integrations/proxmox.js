// Proxmox VE — API token auth, same fields as homepage (username = USER@REALM!TOKENID, password = secret).
// Token needs PVEAuditor on "/" (read-only).
import { trimUrl } from '../http.js';
import { fmtPair, fmtDuration, pct } from '../format.js';
/** @import { Alert, Context, Widget, WidgetResult } from '$lib/types' */

/**
 * The node's storages for the storage card (filtered by host.storages, unavailable ones kept as `down`)
 * and `main`, the one on the host gauge: host.storage if set, else where the guest disks live
 * (local-zfs / local-lvm), not whatever storage is largest.
 */
function nodeStorages(res, nodeName, { storages: wanted, storage: pinned }) {
  // PBS datastores attached to PVE are reported by the PBS widget, and they aren't host disks
  const onNode = res.filter((r) => r.type === 'storage' && r.node === nodeName && r.plugintype !== 'pbs');
  const up = onNode.filter((r) => r.status === 'available' && r.maxdisk > 0);
  const shown = (r) => (wanted ? wanted.includes(r.storage) : true);
  const chosen = pinned ? up.find((r) => r.storage === pinned) : null;
  const guestDisks = up.filter((r) => !r.shared && /\b(images|rootdir)\b/.test(r.content ?? '')).sort((a, b) => b.maxdisk - a.maxdisk)[0];
  return {
    storages: up.filter(shown).map((s) => ({ name: s.storage, used: s.disk, total: s.maxdisk, pct: pct(s.disk, s.maxdisk), sub: fmtPair(s.disk, s.maxdisk), source: 'pve' })),
    // e.g. a mount that is gone: keep it visible, a backup target that silently disappears is worse
    down: onNode.filter((r) => r.status !== 'available' && shown(r)),
    main: chosen ?? guestDisks,
    missing: pinned && !chosen ? pinned : null
  };
}

/**
 * @param {Widget} w
 * @param {Context} ctx
 * @returns {Promise<WidgetResult>}
 */
export async function collect(w, ctx) {
  const base = trimUrl(w.url) + '/api2/json';
  const opts = { headers: { Authorization: `PVEAPIToken=${w.username}=${w.password}` }, insecure: ctx.insecure };
  const { data: res } = await ctx.getJson(`${base}/cluster/resources`, opts);

  const nodes = res.filter((r) => r.type === 'node');
  const node = nodes.find((n) => n.node === (w.node || ctx.settings.host.node)) || nodes.find((n) => n.status === 'online') || nodes[0];
  if (!node) throw new Error('No node found in cluster/resources');
  // a token without Sys.Audit still sees the node, just without its stats
  if (node.maxmem == null) throw new Error('Token cannot read node stats: give it PVEAuditor on / (on the token too if it is privilege-separated)');
  const onNode = (r) => (w.node || ctx.settings.host.node ? r.node === node.node : true);

  const guests = res
    .filter((r) => (r.type === 'qemu' || r.type === 'lxc') && !r.template && onNode(r))
    .map((g) => ({ id: g.vmid, name: g.name, type: g.type === 'qemu' ? 'VM' : 'LXC', status: g.status }));
  const running = guests.filter((g) => g.status === 'running').length;

  const { storages, down, main, missing } = nodeStorages(res, node.node, ctx.settings.host);

  let status = null;
  try { status = (await ctx.getJson(`${base}/nodes/${node.node}/status`, opts)).data; } catch { /* optional */ }
  let updates = null;
  try { updates = (await ctx.getJson(`${base}/nodes/${node.node}/apt/update`, opts)).data?.length ?? null; } catch { /* needs Sys.Audit */ }

  const cpu = (node.cpu ?? 0) * 100;
  const memPct = pct(node.mem, node.maxmem) ?? 0;
  ctx.metric('host.cpu', cpu);
  ctx.metric('host.mem', memPct);
  const rootPct = pct(node.disk, node.maxdisk);
  ctx.metric('host.root', rootPct);
  for (const s of storages) ctx.metric(`storage.pve.${s.name}`, s.pct);
  ctx.shared.guestIds = new Set(guests.map((g) => String(g.id)));
  ctx.shared.guestNames = Object.fromEntries(guests.map((g) => [String(g.id), g.name]));

  /** @type {Alert[]} */
  const alerts = [];
  if (node.status !== 'online') alerts.push({ sev: 'crit', title: `Node ${node.node} is offline`, detail: 'Proxmox reports the node as ' + node.status });
  if (updates) alerts.push({ sev: 'info', key: 'updates', title: `${updates} updates available on ${node.node}`, detail: 'apt packages pending' });
  for (const s of down) alerts.push({ sev: 'warn', key: `storage-${s.storage}`, title: `${s.storage} is unavailable on ${node.node}`, detail: `Proxmox reports the storage as ${s.status ?? 'unknown'}` });
  if (missing) alerts.push({ sev: 'warn', key: 'host-storage', title: `host.storage "${missing}" not found on ${node.node}`, detail: 'The host gauge falls back to the guest-disk storage' });

  return {
    stats: [
      { k: 'CPU', v: `${Math.round(cpu)}%` },
      { k: 'RAM', v: fmtPair(node.mem, node.maxmem) },
      { k: 'guests', v: `${running} / ${guests.length}` }
    ],
    line: `CPU ${Math.round(cpu)}% · RAM ${fmtPair(node.mem, node.maxmem)}`,
    alerts,
    storage: [...storages, ...down.map((s) => ({ name: s.storage, offline: true, sub: 'unavailable', source: 'pve' }))],
    host: {
      node: node.node,
      cpu,
      cpus: node.maxcpu,
      mem: node.mem,
      maxmem: node.maxmem,
      memPct,
      disk: main
        ? { name: main.storage, pct: pct(main.disk, main.maxdisk), sub: fmtPair(main.disk, main.maxdisk) }
        : { name: 'root', pct: rootPct, sub: fmtPair(node.disk, node.maxdisk) },
      load: status?.loadavg?.map(Number) ?? null,
      uptime: node.uptime ? fmtDuration(node.uptime * 1000) : null,
      guestsRunning: running,
      guestsTotal: guests.length,
      updates
    }
  };
}
