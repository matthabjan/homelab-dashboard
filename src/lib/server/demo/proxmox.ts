// Proxmox VE: one node with guest disks on local-zfs. "issues": the NFS backup storage is gone.
import { GiB, TiB } from '../format.ts';
import type { Fixtures } from '$lib/types';
import type { SmartAttribute } from '../integrations/smart.ts';
import type { PveAptUpdate, PveDisk, PveDiskSmart, PveResource, PveResponse, PveRrdPoint, PveStorage } from '../integrations/proxmox.ts';

// smartctl's NVMe health log, as PVE returns it for NVMe drives (type "text")
const nvmeLog = `
SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)
Critical Warning:                   0x00
Temperature:                        41 Celsius
Available Spare:                    100%
Percentage Used:                    4%
Data Units Written:                 38,912,004 [19.9 TB]
Power Cycles:                       96
Power On Hours:                     9,120
Media and Data Integrity Errors:    0
`;
const ata = (id: number, name: string, normalized: number, raw: number | string): SmartAttribute => ({ id: String(id).padStart(3), name, normalized, value: normalized, worst: normalized, threshold: 0, fail: '-', flags: '-O--CK', raw: String(raw) });

const guests: [number, string, 'qemu' | 'lxc'][] = [[100, 'opnsense', 'qemu'], [101, 'docker-apps', 'qemu'], [102, 'homeassistant', 'qemu'], [103, 'omv', 'qemu'], [104, 'pbs', 'qemu'], [105, 'adguard', 'lxc'], [106, 'sandbox', 'lxc']];
const storage = (name: string, plugintype: string, content: string, used: number, total: number, extra: Partial<PveStorage> = {}): PveStorage =>
  ({ type: 'storage', node: 'pve', storage: name, plugintype, content, status: 'available', shared: 0, disk: used, maxdisk: total, ...extra });

// what a node a few weeks behind has pending
const APT: PveAptUpdate[] = [
  ['pve-manager', '8.2.4', '8.2.7'], ['proxmox-kernel-6.8', '6.8.8-2', '6.8.12-1'], ['qemu-server', '8.2.1', '8.2.4'], ['pve-qemu-kvm', '9.0.0-6', '9.0.2-2'],
  ['libpve-storage-perl', '8.2.3', '8.2.4'], ['pve-container', '5.1.12', '5.2.0'], ['proxmox-backup-client', '3.2.3-1', '3.2.7-1'], ['zfsutils-linux', '2.2.4-pve1', '2.2.6-pve1'],
  ['openssh-server', '1:9.2p1-2+deb12u2', '1:9.2p1-2+deb12u3'], ['libc6', '2.36-9+deb12u7', '2.36-9+deb12u8'], ['curl', '7.88.1-10+deb12u6', '7.88.1-10+deb12u7'], ['tzdata', '2024a-0+deb12u1', '2024b-0+deb12u1']
].map(([Package, OldVersion, Version]) => ({ Package, OldVersion, Version }));

export default {
  'GET /api2/json/cluster/resources': ({ now, scenario }): PveResponse<PveResource[]> => ({
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
  // host NIC, bytes/s per minute; the newest point is still being filled, as in the real RRD
  'GET /api2/json/nodes/:node/rrddata': ({ now }): PveResponse<PveRrdPoint[]> => ({
    data: Array.from({ length: 70 }, (_, i): PveRrdPoint => {
      const t = Math.floor(now / 60_000) - 69 + i;
      return i === 69 ? { time: t * 60 } : { time: t * 60, netin: (2 + Math.abs(Math.sin(t / 9)) * 25) * 125_000, netout: (6 + Math.abs(Math.sin(t / 13)) * 60) * 125_000 };
    })
  }),
  'GET /api2/json/nodes/:node/disks/list': (): PveResponse<PveDisk[]> => ({
    data: [
      { devpath: '/dev/nvme0n1', model: 'Example NVMe 1TB', serial: 'EXNV00000001', size: 1_000_204_886_016, type: 'nvme', rpm: 0, health: 'PASSED', wearout: 96, vendor: 'unknown', used: 'LVM' },
      // PVE calls SATA SSDs "hdd" with rpm "0", and has no wearout for many of them
      { devpath: '/dev/sda', model: 'Example SATA SSD 2TB', serial: 'EXSA00000001', size: 2_000_398_934_016, type: 'hdd', rpm: '0', health: 'PASSED', wearout: 'N/A', vendor: 'Example', used: 'ext4' }
    ]
  }),
  'GET /api2/json/nodes/:node/disks/smart': ({ url, scenario }): PveResponse<PveDiskSmart> =>
    url.searchParams.get('disk') === '/dev/nvme0n1'
      ? { data: { health: 'PASSED', type: 'text', wearout: 96, text: nvmeLog } }
      : {
          data: {
            health: 'PASSED',
            type: 'ata',
            attributes: [
              ata(5, 'Reallocate_NAND_Blk_Cnt', 100, 0),
              ata(9, 'Power_On_Hours', 100, 8_840),
              ata(194, 'Temperature_Celsius', 64, '36 (Min/Max 20/49)'),
              ata(202, 'Percent_Lifetime_Remain', scenario === 'issues' ? 7 : 91, scenario === 'issues' ? 93 : 9),
              ata(246, 'Total_LBAs_Written', 100, 61_250_330_112)
            ]
          }
        },
  'GET /api2/json/nodes/:node/apt/update': (): PveResponse<PveAptUpdate[]> => ({ data: APT })
} satisfies Fixtures;
