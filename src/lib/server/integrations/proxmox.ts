// Proxmox VE — API token auth, same fields as homepage (username = USER@REALM!TOKENID, password = secret).
// Token needs PVEAuditor on "/" (read-only).
import { trimUrl } from '../http.ts';
import { fmtPair, fmtDuration, pct } from '../format.ts';
import { fromAttributes, fromNvmeText, isVirtual, kindOf, slowly, toDrive } from './smart.ts';
import type { SmartAttribute } from './smart.ts';
import type { Alert, Context, Drive, NetworkReading, OfflineRow, Settings, SmartReading, UsageRow, Widget, WidgetResult } from '$lib/types';

/** Every PVE API answer wraps its payload in `data`. */
export interface PveResponse<T> {
  data: T;
}

/** A node in /cluster/resources. */
export interface PveNode {
  type: 'node';
  node: string;
  status: string;
  /** 0–1 */
  cpu?: number;
  maxcpu: number;
  mem: number;
  /** missing (with the other stats) when the token lacks Sys.Audit */
  maxmem?: number;
  disk: number;
  maxdisk: number;
  /** seconds */
  uptime?: number;
}

/** A VM or container in /cluster/resources. */
export interface PveGuest {
  type: 'qemu' | 'lxc';
  vmid: number;
  name: string;
  node: string;
  status: string;
  template?: number;
}

/** A storage of one node in /cluster/resources (shared storages appear once per node). */
export interface PveStorage {
  type: 'storage';
  node: string;
  storage: string;
  plugintype: string;
  /** comma-separated content types, e.g. "images,rootdir" */
  content?: string;
  status?: string;
  shared?: number;
  disk: number;
  maxdisk: number;
}

export type PveResource = PveNode | PveGuest | PveStorage;

/** One point of /nodes/{node}/rrddata, bytes/s averages; the newest can still be empty. */
export interface PveRrdPoint {
  time: number;
  netin?: number;
  netout?: number;
}

/** A pending package in /nodes/{node}/apt/update. */
export interface PveAptUpdate {
  Package: string;
}

/** A physical disk in /nodes/{node}/disks/list. */
export interface PveDisk {
  devpath: string;
  model: string;
  serial: string;
  vendor?: string;
  size: number;
  type?: string;
  /** a number, or "0" for SATA SSDs */
  rpm?: number | string;
  health?: string;
  /** % left, or "N/A" */
  wearout?: number | string;
  used?: string;
}

/** /nodes/{node}/disks/smart: smartctl's text for NVMe, an attribute table for ATA. */
export interface PveDiskSmart {
  health?: string;
  type: 'text' | 'ata';
  wearout?: number | string;
  text?: string;
  attributes?: SmartAttribute[];
}

/**
 * The node's storages for the Storage panel (filtered by host.storages, unavailable ones kept as `down`)
 * and `main`, the one on the host gauge: host.storage if set, else where the guest disks live
 * (local-zfs / local-lvm), not whatever storage is largest.
 */
function nodeStorages(res: PveResource[], nodeName: string, { storages: wanted, storage: pinned }: Pick<Settings['host'], 'storages' | 'storage'>) {
  // PBS datastores attached to PVE are reported by the PBS widget, and they aren't host disks
  const onNode = res.filter((r): r is PveStorage => r.type === 'storage' && r.node === nodeName && r.plugintype !== 'pbs');
  const up = onNode.filter((r) => r.status === 'available' && r.maxdisk > 0);
  const shown = (r: PveStorage) => (wanted ? wanted.includes(r.storage) : true);
  const chosen = pinned ? up.find((r) => r.storage === pinned) : null;
  const guestDisks = up.filter((r) => !r.shared && /\b(images|rootdir)\b/.test(r.content ?? '')).sort((a, b) => b.maxdisk - a.maxdisk)[0];
  return {
    storages: up.filter(shown).map((s): UsageRow => ({ name: s.storage, used: s.disk, total: s.maxdisk, pct: pct(s.disk, s.maxdisk), sub: fmtPair(s.disk, s.maxdisk), source: 'pve' })),
    // e.g. a mount that is gone: keep it visible, a backup target that silently disappears is worse
    down: onNode.filter((r) => r.status !== 'available' && shown(r)),
    main: chosen ?? guestDisks,
    missing: pinned && !chosen ? pinned : null
  };
}

/**
 * The node's physical disks with SMART details (Sys.Audit, part of PVEAuditor), refreshed every 10 minutes.
 */
async function nodeDrives(ctx: Context, base: string, opts: object, nodeName: string): Promise<Drive[]> {
  const url = `${base}/nodes/${nodeName}/disks`;
  const list = (await ctx.getJson<PveResponse<PveDisk[]>>(`${url}/list`, opts)).data ?? [];
  return Promise.all(list.filter((d) => !isVirtual(d)).map(async (d) => {
    let smart: PveDiskSmart | null = null;
    try { smart = (await ctx.getJson<PveResponse<PveDiskSmart>>(`${url}/smart?disk=${encodeURIComponent(d.devpath)}`, opts)).data; } catch { /* health and wearout from the list still show */ }
    const reading: SmartReading | null = !smart ? null : smart.type === 'text' ? fromNvmeText(smart.text ?? '') : fromAttributes(smart.attributes ?? []);
    return toDrive({ model: d.model, serial: d.serial, kind: kindOf(d.type, d.rpm), size: d.size, status: d.health, wearout: d.wearout, smart: reading, where: nodeName });
  }));
}

export async function collect(w: Widget, ctx: Context): Promise<WidgetResult> {
  const base = trimUrl(w.url) + '/api2/json';
  const opts = { headers: { Authorization: `PVEAPIToken=${w.username}=${w.password}` }, insecure: ctx.insecure };
  const { data: res } = await ctx.getJson<PveResponse<PveResource[]>>(`${base}/cluster/resources`, opts);

  const nodes = res.filter((r) => r.type === 'node');
  const node = nodes.find((n) => n.node === (w.node || ctx.settings.host.node)) || nodes.find((n) => n.status === 'online') || nodes[0];
  if (!node) throw new Error('No node found in cluster/resources');
  // a token without Sys.Audit still sees the node, just without its stats
  if (node.maxmem == null) throw new Error('Token cannot read node stats: give it PVEAuditor on / (on the token too if it is privilege-separated)');
  const onNode = (r: PveResource) => (w.node || ctx.settings.host.node ? r.node === node.node : true);

  const guests = res
    .filter((r): r is PveGuest => (r.type === 'qemu' || r.type === 'lxc') && !r.template && onNode(r))
    .map((g) => ({ id: g.vmid, name: g.name, type: g.type === 'qemu' ? 'VM' : 'LXC', status: g.status }));
  const running = guests.filter((g) => g.status === 'running').length;

  const { storages, down, main, missing } = nodeStorages(res, node.node, ctx.settings.host);

  let updates: number | null = null;
  try { updates = (await ctx.getJson<PveResponse<PveAptUpdate[]>>(`${base}/nodes/${node.node}/apt/update`, opts)).data?.length ?? null; } catch { /* needs Sys.Modify, which PVEAuditor lacks */ }
  // the host NIC: LAN traffic to and from the server (NAS, backups, apps). RRD points are bytes/s averages; the newest can still be empty
  let lan: NetworkReading | null = null;
  try {
    const rrd = (await ctx.getJson<PveResponse<PveRrdPoint[]>>(`${base}/nodes/${node.node}/rrddata?timeframe=hour&cf=AVERAGE`, opts)).data ?? [];
    const last = rrd.findLast((p): p is Required<PveRrdPoint> => p.netin != null && p.netout != null);
    if (last) lan = { down: (last.netin * 8) / 1e6, up: (last.netout * 8) / 1e6, source: node.node };
  } catch { /* optional */ }
  if (lan) { ctx.metric('lan.down', lan.down); ctx.metric('lan.up', lan.up); }
  const drives = (await slowly(ctx, 'drives', () => nodeDrives(ctx, base, opts, node.node))) ?? [];

  const cpu = (node.cpu ?? 0) * 100;
  const memPct = pct(node.mem, node.maxmem) ?? 0;
  ctx.metric('host.cpu', cpu);
  ctx.metric('host.mem', memPct);
  const rootPct = pct(node.disk, node.maxdisk);
  ctx.metric('host.root', rootPct);
  for (const s of storages) ctx.metric(`storage.pve.${s.name}`, s.pct);
  ctx.shared.guestIds = new Set(guests.map((g) => String(g.id)));
  ctx.shared.guestNames = Object.fromEntries(guests.map((g) => [String(g.id), g.name]));

  const alerts: Alert[] = [];
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
    storage: [...storages, ...down.map((s): OfflineRow => ({ name: s.storage, offline: true, sub: 'unavailable', source: 'pve' }))],
    lan,
    drives,
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
      uptime: node.uptime ? fmtDuration(node.uptime * 1000) : null,
      guestsRunning: running,
      guestsTotal: guests.length,
      updates
    }
  };
}
