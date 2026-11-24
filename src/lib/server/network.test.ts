// The Network panel through its interface: the widgets' readings, the pick from settings and a metric history in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { network, type WidgetReport } from './network.ts';
import type { History } from './system.ts';
import type { WidgetState } from '#lib/types';

const H = 3600_000;
const now = 100 * H;
const asked: string[] = [];
const history: History = (key) => { asked.push(key); return { values: [1, 2], lo: [0, 1], hi: [2, 3], from: now - 24 * H }; };
const w = (name: string, parts: Partial<WidgetState>): WidgetReport => ({ s: { id: name.toLowerCase(), name, href: `https://${name.toLowerCase()}.home.arpa` }, w: { ok: true, ts: now, lastOk: now, stats: [], line: '', alerts: [], ...parts } });
const router = w('OPNsense', { network: { down: 52.6, up: 7, source: 'OPNsense' } });
const fritz = w('FRITZ!Box', { network: { down: 30, up: 4, source: 'FRITZ!Box', fallback: true } });
const pve = w('PVE', { lan: { down: 23.2, up: 18.9, source: 'pve' } });
const dnsStats = { queries: 48000, blockedPct: 18.4 } as NonNullable<WidgetState['dns']>;
const adguard = w('AdGuard Home', { dns: dnsStats });
const pihole = w('Pi-hole', { dns: { ...dnsStats, queries: 31000 } });

test('no widget reports traffic or DNS: no panel', () => {
  assert.equal(network([w('Portainer', {})], undefined, now, history), null);
});

test('WAN: a router before the FRITZ!Box, each with its own metrics; settings.network.service picks by name', () => {
  asked.length = 0;
  const auto = network([fritz, router], undefined, now, history);
  assert.deepEqual([auto?.source, auto?.href, auto?.down, auto?.up, auto?.spanH], ['OPNsense', 'https://opnsense.home.arpa', 52.6, 7, 24]);
  assert.deepEqual(asked, ['net.down', 'net.up']);
  assert.deepEqual([auto?.seriesDown, auto?.downLo, auto?.downHi], [[1, 2], [0, 1], [2, 3]]);
  asked.length = 0;
  assert.equal(network([fritz], undefined, now, history)?.source, 'FRITZ!Box');
  assert.deepEqual(asked, ['fritz.down', 'fritz.up']);
  assert.equal(network([fritz, router], { service: 'FRITZ!Box', dns: null }, now, history)?.source, 'FRITZ!Box');
});

test('LAN and DNS stand on their own: without WAN traffic the panel has only them', () => {
  const n = network([pve, adguard], undefined, now, history);
  assert.deepEqual([n?.source, n?.down, n?.seriesDown], [null, null, null]);
  assert.deepEqual([n?.lan?.source, n?.lan?.down, n?.lan?.href], ['pve', 23.2, 'https://pve.home.arpa']);
  assert.deepEqual([n?.dns?.name, n?.dns?.href, n?.dns?.queries], ['AdGuard Home', 'https://adguard home.home.arpa', 48000]);
});

test('DNS: the first widget with statistics, or the one settings.network.dns names', () => {
  assert.equal(network([adguard, pihole], undefined, now, history)?.dns?.name, 'AdGuard Home');
  assert.equal(network([adguard, pihole], { service: null, dns: 'Pi-hole' }, now, history)?.dns?.queries, 31000);
});
