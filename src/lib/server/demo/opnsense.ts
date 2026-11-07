// OPNsense: cumulative WAN counters growing at a slowly changing rate (~70 / 10 Mbit/s),
// so the integration derives rates from consecutive polls just like in production.
// bytes so far = integral of rate(t) = bytesPerS · (1 + 0.3 · sin(t / 1 h))
// "issues": the backup LTE gateway loses packets and a firmware update is pending; "calm": both fine.
import type { Fixtures } from '$lib/types';
import type { OpnsenseActivity, OpnsenseFirmware, OpnsenseGateways, OpnsenseServices, OpnsenseTraffic } from '../integrations/opnsense.ts';

const counter = (now: number, bytesPerS: number) => {
  const t = now / 1000, T = 3600;
  return String(Math.floor(bytesPerS * (t - 0.3 * T * Math.cos(t / T))));
};

export default {
  'GET /api/diagnostics/activity/getActivity': (): OpnsenseActivity => ({
    headers: ['last pid: 4242;  load averages:  0.12,  0.10,  0.08', '62 processes: 1 running, 61 sleeping', 'CPU:  1.2% user,  0.0% nice,  2.1% system,  0.4% interrupt, 96.3% idle']
  }),
  'GET /api/diagnostics/traffic/interface': ({ now }): OpnsenseTraffic => ({
    interfaces: { wan: { 'bytes received': counter(now, 9e6), 'bytes transmitted': counter(now, 1.2e6) } }
  }),
  'GET /api/routes/gateway/status': ({ scenario }): OpnsenseGateways => ({
    items: [
      { name: 'WAN_DHCP', address: '100.64.0.1', status: 'none', status_translated: 'Online', delay: '8.2 ms', loss: '0.0 %' },
      scenario === 'issues'
        ? { name: 'LTE_BACKUP', address: '10.64.64.1', status: 'loss', status_translated: 'Packetloss', delay: '61.4 ms', loss: '22.0 %' }
        : { name: 'LTE_BACKUP', address: '10.64.64.1', status: 'none', status_translated: 'Online', delay: '38.9 ms', loss: '0.0 %' }
    ]
  }),
  'GET /api/core/service/search': (): OpnsenseServices => ({
    rows: [
      { id: 'configd', name: 'configd', description: 'System Configuration Daemon', running: 1, locked: 1 },
      { id: 'unbound', name: 'unbound', description: 'Unbound DNS', running: 1, locked: 0 },
      { id: 'dhcpd', name: 'dhcpd', description: 'DHCPv4 Server', running: 1, locked: 0 },
      { id: 'ntpd', name: 'ntpd', description: 'Network Time Daemon', running: 1, locked: 0 },
      { id: 'pf', name: 'pf', description: 'Packet Filter', running: 0, locked: 1 }
    ]
  }),
  'GET /api/core/firmware/status': ({ scenario }): OpnsenseFirmware => scenario === 'issues'
    ? {
      status: 'update', status_reboot: '1', product: { product_version: '25.7.4', product_latest: '25.7.5' },
      all_packages: Object.fromEntries(['opnsense', 'base', 'kernel', 'openssl', 'unbound'].map((name) => [name, { name, old: '1', new: '2' }]))
    }
    : { status: 'none', product: { product_version: '25.7.5', product_latest: '25.7.5' } }
} satisfies Fixtures;
