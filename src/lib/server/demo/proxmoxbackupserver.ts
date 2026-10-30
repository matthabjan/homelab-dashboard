// Proxmox Backup Server: datastore "main" plus a removable "offsite" disk.
// "issues": guest 103 missed its last backup and the offsite disk is unplugged; "calm": it is plugged in.
import { TiB } from '../format.ts';
import type { Fixtures } from '$lib/types';
import type { PbsBackupGroup, PbsDatastoreUsage, PbsDisk, PbsDiskSmart, PbsResponse } from '../integrations/pbs.ts';

const H = 3600_000;

export default {
  'GET /api2/json/status/datastore-usage': ({ scenario }): PbsResponse<PbsDatastoreUsage[]> => ({
    data: [
      { store: 'main', 'mount-status': 'nonremovable', total: 2 * TiB, used: 1.24 * TiB, avail: 0.76 * TiB },
      scenario === 'calm'
        ? { store: 'offsite', 'mount-status': 'mounted', total: 4 * TiB, used: 1.3 * TiB, avail: 2.7 * TiB }
        : { store: 'offsite', 'mount-status': 'notmounted' }
    ]
  }),
  'GET /api2/json/admin/datastore/:store/groups': ({ now, scenario, params }): PbsResponse<PbsBackupGroup[]> => ({
    data: params.store !== 'main' ? [] : ['100', '101', '102', '103', '104', '105'].map((id): PbsBackupGroup => ({
      'backup-type': id === '105' ? 'ct' : 'vm',
      'backup-id': id,
      'last-backup': Math.floor((now - (scenario === 'issues' && id === '103' ? 30 : 6) * H) / 1000),
      comment: ''
    }))
  }),
  // the VM's own disks are virtual and skipped; the offsite USB disk only exists while it is plugged in
  'GET /api2/json/nodes/localhost/disks/list': ({ scenario }): PbsResponse<PbsDisk[]> => ({
    data: [
      { name: 'sda', devpath: '/dev/sda', model: 'QEMU_HARDDISK', serial: 'drive-scsi0', vendor: 'QEMU', size: 34_359_738_368, 'disk-type': 'ssd', status: 'passed', wearout: null, rpm: null, used: 'lvm' },
      { name: 'vda', devpath: '/dev/vda', model: null, serial: null, vendor: '0x1af4', size: 902_579_617_792, 'disk-type': 'hdd', status: 'unknown', wearout: null, rpm: null, used: 'mounted' },
      ...(scenario === 'calm'
        ? [{ name: 'sdb', devpath: '/dev/sdb', model: 'Example USB HDD 4TB', serial: 'EXUS00000001', vendor: 'Example', size: 4_000_787_030_016, 'disk-type': 'usb', status: 'passed', wearout: null, rpm: 5400, used: 'mounted' }]
        : [])
    ]
  }),
  'GET /api2/json/nodes/localhost/disks/smart': (): PbsResponse<PbsDiskSmart> => ({
    data: {
      status: 'passed',
      wearout: null,
      attributes: [
        { id: 5, name: 'Reallocated_Sector_Ct', value: '0', normalized: 100, worst: 100, threshold: 10, fail: '-' },
        { id: 9, name: 'Power_On_Hours', value: '3120', normalized: 97, worst: 97, threshold: 0, fail: '-' },
        { id: 194, name: 'Temperature_Celsius', value: '31', normalized: 31, worst: 45, threshold: 0, fail: '-' }
      ]
    }
  })
} satisfies Fixtures;
