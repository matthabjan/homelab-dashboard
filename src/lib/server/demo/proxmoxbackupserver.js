// Proxmox Backup Server: datastore "main" plus a removable "offsite" disk that is unplugged.
// "issues": guest 103 missed its last backup.
import { TiB } from '../format.js';

const H = 3600_000;

export default {
  'GET /api2/json/status/datastore-usage': () => ({
    data: [
      { store: 'main', 'mount-status': 'nonremovable', total: 2 * TiB, used: 1.24 * TiB, avail: 0.76 * TiB },
      { store: 'offsite', 'mount-status': 'notmounted' }
    ]
  }),
  'GET /api2/json/admin/datastore/:store/groups': ({ now, scenario, params }) => ({
    data: params.store !== 'main' ? [] : ['100', '101', '102', '103', '104', '105'].map((id) => ({
      'backup-type': id === '105' ? 'ct' : 'vm',
      'backup-id': id,
      'last-backup': Math.floor((now - (scenario === 'issues' && id === '103' ? 30 : 6) * H) / 1000),
      comment: ''
    }))
  })
};
