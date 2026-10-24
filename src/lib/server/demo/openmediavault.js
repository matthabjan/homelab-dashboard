// OpenMediaVault JSON-RPC: everything goes to /rpc.php, routed on service.method.
// "data" sits on a passed-through disk with SMART; "scratch" is a virtual disk without.
const smart = [{ devicefile: '/dev/sdb', model: 'WDC WD80EFZZ', monitor: true, overallstatus: 'GOOD' }];
const filesystems = [
  { label: 'data', devicefile: '/dev/sdb1', canonicaldevicefile: '/dev/sdb1', parentdevicefile: '/dev/sdb', mountpoint: '/srv/dev-disk-by-label-data', size: '8000000000000', available: '2300000000000' },
  { label: 'scratch', devicefile: '/dev/sdc', canonicaldevicefile: '/dev/sdc', parentdevicefile: '/dev/sdc', mountpoint: '/srv/dev-disk-by-label-scratch', size: '536870912000', available: '408021893120' }
];

const methods = {
  'session.login': () => ({ authenticated: true }),
  'services.getStatus': () => ({ data: [{ name: 'smb', title: 'SMB/CIFS', enabled: true, running: true }, { name: 'nfs', title: 'NFS', enabled: true, running: true }, { name: 'ssh', title: 'SSH', enabled: true, running: true }] }),
  'smart.getListBg': () => '/tmp/bgstatus-demo',
  'exec.getOutput': () => ({ running: false, pos: 0, output: JSON.stringify({ data: smart }) }),
  'filesystemmgmt.enumerateMountedFilesystems': () => filesystems
};

export default {
  'POST /rpc.php': ({ body }) => {
    const m = methods[`${body?.service}.${body?.method}`];
    return m ? { response: m(), error: null } : { response: null, error: { code: 0, message: `no fixture for ${body?.service}.${body?.method}` } };
  }
};
