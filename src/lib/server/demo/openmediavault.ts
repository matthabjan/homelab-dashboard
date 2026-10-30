// OpenMediaVault JSON-RPC: everything goes to /rpc.php, routed on service.method.
// "data" sits on a passed-through disk with SMART; "scratch" is a virtual disk without.
// devicefile is a by-id link, canonicaldevicefile the plain device; virtual disks have monitoring off
import type { Fixtures } from '$lib/types';
import type {
  OmvExecOutput, OmvFilesystem, OmvList, OmvLogin, OmvRpcRequest, OmvRpcResponse, OmvServiceStatus, OmvSmartDevice, OmvSmartExtended, OmvSystemInformation
} from '../integrations/openmediavault.ts';

const smart: OmvSmartDevice[] = [
  { devicefile: '/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_drive-scsi0', canonicaldevicefile: '/dev/sda', model: 'QEMU HARDDISK', serialnumber: 'drive-scsi0', size: '34359738368', temperature: '0', monitor: false, overallstatus: 'BAD_STATUS' },
  { devicefile: '/dev/disk/by-id/ata-Example_NAS_HDD_8TB_EXHD00000001', canonicaldevicefile: '/dev/sdb', model: 'Example NAS HDD 8TB', serialnumber: 'EXHD00000001', size: '8001563222016', temperature: '35', monitor: true, overallstatus: 'GOOD' }
];
// what smartctl -x prints for a SATA hard disk (only the parts the integration reads)
const extended = `Device Model:     Example NAS HDD 8TB
Rotation Rate:    5400 rpm
SMART overall-health self-assessment test result: PASSED
ID# ATTRIBUTE_NAME          FLAGS    VALUE WORST THRESH FAIL RAW_VALUE
  5 Reallocated_Sector_Ct   PO--CK   200   200   140    -    0
  9 Power_On_Hours          -O--CK   071   071   000    -    21034
194 Temperature_Celsius     -O---K   117   104   000    -    35 (Min/Max 18/43)
197 Current_Pending_Sector  -O--CK   200   200   000    -    0
`;
// issues: the small scratch disk is nearly full, so the fullest disk isn't the largest
const filesystems = (scenario: string): OmvFilesystem[] => [
  { label: 'data', devicefile: '/dev/sdb1', canonicaldevicefile: '/dev/sdb1', parentdevicefile: '/dev/sdb', mountpoint: '/srv/dev-disk-by-label-data', size: '8000000000000', available: '2300000000000' },
  { label: 'scratch', devicefile: '/dev/sdc', canonicaldevicefile: '/dev/sdc', parentdevicefile: '/dev/sdc', mountpoint: '/srv/dev-disk-by-label-scratch', size: '536870912000', available: scenario === 'issues' ? '53687091200' : '408021893120' }
];

const methods: Record<string, ((req: { scenario: string }) => unknown) | undefined> = {
  'session.login': (): OmvLogin => ({ authenticated: true }),
  'system.getInformation': ({ scenario }): OmvSystemInformation => ({ hostname: 'nas', version: '7.4.0-1 (Sandworm)', availablePkgUpdates: scenario === 'issues' ? 4 : 0, rebootRequired: false, configDirty: false }),
  'services.getStatus': (): OmvList<OmvServiceStatus> => ({ data: [{ name: 'smb', title: 'SMB/CIFS', enabled: true, running: true }, { name: 'nfs', title: 'NFS', enabled: true, running: true }, { name: 'ssh', title: 'SSH', enabled: true, running: true }] }),
  'smart.getListBg': (): string => '/tmp/bgstatus-demo',
  'smart.getExtendedInformation': (): OmvSmartExtended => extended,
  'exec.getOutput': (): OmvExecOutput => ({ running: false, pos: 0, output: JSON.stringify({ data: smart } satisfies OmvList<OmvSmartDevice>) }),
  'filesystemmgmt.enumerateMountedFilesystems': ({ scenario }): OmvFilesystem[] => filesystems(scenario)
};

export default {
  'POST /rpc.php': ({ scenario, body: sent }): OmvRpcResponse => {
    const body = sent as OmvRpcRequest | null; // what the integration's rpc() posts
    const m = methods[`${body?.service}.${body?.method}`];
    return m ? { response: m({ scenario }), error: null } : { response: null, error: { code: 0, message: `no fixture for ${body?.service}.${body?.method}` } };
  }
} satisfies Fixtures;
