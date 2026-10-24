// Proxmox VE: one node with guest disks on local-zfs. "issues": the NFS backup storage is gone.
import { GiB, TiB } from '../format.js';

const guests = [[100, 'opnsense', 'qemu'], [101, 'docker-apps', 'qemu'], [102, 'homeassistant', 'qemu'], [103, 'omv', 'qemu'], [104, 'pbs', 'qemu'], [105, 'adguard', 'lxc'], [106, 'sandbox', 'lxc']];
const storage = (name, plugintype, content, used, total, extra = {}) =>
  ({ type: 'storage', node: 'pve', storage: name, plugintype, content, status: 'available', shared: 0, disk: used, maxdisk: total, ...extra });

export default {
  'GET /api2/json/cluster/resources': ({ now, scenario }) => ({
    data: [
      { type: 'node', node: 'pve', status: 'online', cpu: (18 + Math.sin(now / 420_000) * 6 + Math.random() * 4) / 100, maxcpu: 16, mem: (41 + Math.random() * 0.5) * GiB, maxmem: 64 * GiB, disk: 21 * GiB, maxdisk: 94 * GiB, uptime: 38 * 86_400 },
      ...guests.map(([vmid, name, type]) => ({ type, vmid, name, node: 'pve', status: vmid === 106 ? 'stopped' : 'running', template: 0 })),
      storage('local', 'dir', 'iso,vztmpl,snippets', 21 * GiB, 94 * GiB),
      storage('local-zfs', 'zfspool', 'images,rootdir', 532 * GiB, 920 * GiB),
      storage('main', 'pbs', 'backup', 1.24 * TiB, 2 * TiB, { shared: 1 }),
      scenario === 'issues'
        ? storage('nas-backup', 'nfs', 'backup', 0, 0, { shared: 1, status: 'unknown' })
        : storage('nas-backup', 'nfs', 'backup', 1.1 * TiB, 4 * TiB, { shared: 1 })
    ]
  }),
  'GET /api2/json/nodes/:node/status': () => ({ data: { loadavg: ['1.42', '1.38', '1.21'] } }),
  'GET /api2/json/nodes/:node/apt/update': () => ({ data: Array.from({ length: 12 }, (_, i) => ({ Package: `pkg-${i}` })) })
};
