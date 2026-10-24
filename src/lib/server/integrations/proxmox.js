// Proxmox VE — API token auth, same fields as homepage (username = USER@REALM!TOKENID, password = secret).
// Token needs PVEAuditor on "/" (read-only).
import { getJson, trimUrl } from '../http.js';
import { fmtPair, fmtDuration, pct } from '../format.js';

export async function collect(w, ctx) {
  const base = trimUrl(w.url) + '/api2/json';
  const opts = { headers: { Authorization: `PVEAPIToken=${w.username}=${w.password}` }, insecure: ctx.insecure };
  const { data: res } = await getJson(`${base}/cluster/resources`, opts);

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

  const wanted = ctx.settings.host.storages;
  const storages = res
    .filter((r) => r.type === 'storage' && r.node === node.node && r.status === 'available' && r.maxdisk > 0)
    .filter((r) => (wanted ? wanted.includes(r.storage) : true))
    .map((s) => ({ name: s.storage, used: s.disk, total: s.maxdisk, pct: pct(s.disk, s.maxdisk), sub: fmtPair(s.disk, s.maxdisk), source: 'pve' }));

  let status = null;
  try { status = (await getJson(`${base}/nodes/${node.node}/status`, opts)).data; } catch { /* optional */ }
  let updates = null;
  try { updates = (await getJson(`${base}/nodes/${node.node}/apt/update`, opts)).data?.length ?? null; } catch { /* needs Sys.Audit */ }

  const cpu = (node.cpu ?? 0) * 100;
  const memPct = pct(node.mem, node.maxmem);
  ctx.metric('host.cpu', cpu);
  ctx.metric('host.mem', memPct);
  const rootPct = pct(node.disk, node.maxdisk);
  ctx.metric('host.root', rootPct);
  for (const s of storages) ctx.metric(`storage.pve.${s.name}`, s.pct);
  ctx.shared.guestIds = new Set(guests.map((g) => String(g.id)));
  ctx.shared.guestNames = Object.fromEntries(guests.map((g) => [String(g.id), g.name]));

  const alerts = [];
  if (node.status !== 'online') alerts.push({ sev: 'crit', title: `Node ${node.node} is offline`, detail: 'Proxmox reports the node as ' + node.status });
  if (updates) alerts.push({ sev: 'info', key: 'updates', title: `${updates} updates available on ${node.node}`, detail: 'apt packages pending' });

  // the largest PVE storage is what the host gauge shows (usually local-zfs / local-lvm)
  const main = [...storages].sort((a, b) => b.total - a.total)[0];

  return {
    stats: [
      { k: 'CPU', v: `${Math.round(cpu)}%` },
      { k: 'RAM', v: fmtPair(node.mem, node.maxmem) },
      { k: 'guests', v: `${running} / ${guests.length}` }
    ],
    line: `CPU ${Math.round(cpu)}% · RAM ${fmtPair(node.mem, node.maxmem)}`,
    alerts,
    storage: storages,
    host: {
      node: node.node,
      cpu,
      cpus: node.maxcpu,
      mem: node.mem,
      maxmem: node.maxmem,
      memPct,
      disk: main ? { name: main.name, pct: main.pct, sub: main.sub } : { name: 'root', pct: rootPct, sub: fmtPair(node.disk, node.maxdisk) },
      load: status?.loadavg?.map(Number) ?? null,
      uptime: node.uptime ? fmtDuration(node.uptime * 1000) : null,
      guestsRunning: running,
      guestsTotal: guests.length,
      updates
    }
  };
}
