// Every integration, in both demo scenarios, against the API fixtures the demo serves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRATIONS, ORDER, createContext } from './index.ts';
import { FIXTURES, fixtureTransport } from '../demo/index.ts';
import { DEFAULT_SETTINGS } from '../config.ts';
import { crossed, fieldPath, formatValue } from './customapi.ts';
import { memoryKv } from '../test-helpers.ts';
import type { CustomApiMapping, Fixtures, Json, Shared, Transport, Widget, WidgetResult } from '$lib/types';

/** A widget block without its type, which each test adds. */
type WidgetOptions = { url: string; [option: string]: unknown };

const TABLES: Record<string, Fixtures> = FIXTURES;

const WIDGETS: Record<string, WidgetOptions> = {
  proxmox: { url: 'https://pve.test:8006', username: 'u@pve!t', password: 's' },
  proxmoxbackupserver: { url: 'https://pbs.test:8007', username: 'u@pbs!t', password: 's' },
  opnsense: { url: 'https://opnsense.test', username: 'k', password: 's' },
  fritzbox: { url: 'http://fritz.test' },
  adguard: { url: 'https://adguard.test', username: 'admin', password: 's' },
  portainer: { url: 'https://portainer.test', env: 1, key: 'k' },
  openmediavault: { url: 'https://nas.test', username: 'admin', password: 's' },
  docker: { url: 'http://socket-proxy.test:2375' },
  pihole: { url: 'https://pihole.test', key: 's' },
  customapi: {
    url: 'https://media.test/api/status',
    mappings: [
      { field: 'sessions.active', label: 'sessions', format: 'number' },
      { field: { library: 'items' }, label: 'items', format: 'number' },
      { field: 'healthy', label: 'health', remap: [{ value: true, to: 'OK' }, { value: false, to: 'Degraded' }], crit: { below: 1 } }
    ]
  }
};

test('every integration has a fixture table and a widget here', () => {
  assert.deepEqual(Object.keys(FIXTURES).sort(), Object.keys(INTEGRATIONS).sort());
  assert.deepEqual(Object.keys(WIDGETS).sort(), Object.keys(INTEGRATIONS).sort());
});

test('PBS reports backups made while the dashboard was restarting', async () => {
  const kv = memoryKv();
  const run = (now: number) => {
    const ctx = createContext({ transport: fixtureTransport(FIXTURES.proxmoxbackupserver, { scenario: 'calm', now }), kv, settings: DEFAULT_SETTINGS, now });
    return INTEGRATIONS.proxmoxbackupserver.collect({ type: 'proxmoxbackupserver', ...WIDGETS.proxmoxbackupserver }, ctx);
  };
  const t0 = Date.now();
  assert.deepEqual((await run(t0)).events, []);
  // fresh ctx.state, same kv: a restart
  const after = await run(t0 + 3600_000);
  assert.equal(after.events?.[0]?.title, 'Backups completed');
});

test('Portainer: a stopped container is a failure, a finished one-shot job is not', async () => {
  const run = async (scenario: string) => {
    const ctx = createContext({ transport: fixtureTransport(FIXTURES.portainer, { scenario }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now() });
    return INTEGRATIONS.portainer.collect({ type: 'portainer', ...WIDGETS.portainer }, ctx);
  };
  const calm = await run('calm');
  assert.equal(calm.containers?.failed, 0, 'certbot-renew exited 0 with no restart policy');
  assert.deepEqual(calm.alerts, []);
  const issues = await run('issues');
  // music-assistant crashed; wud exited 0 but is `unless-stopped`
  assert.equal(issues.containers?.failed, 2);
  // wud is its own tile (labels, no siteMonitor), so only music-assistant alerts here
  assert.deepEqual(issues.alerts.map((a) => a.title), ['Container music-assistant stopped']);
  assert.equal(issues.discovered?.find((d) => d.name === "What's Up Docker")?.container.state, 'exited');
});

test('Portainer looks up a restart policy once per container', async () => {
  const fixtures = fixtureTransport(FIXTURES.portainer, { scenario: 'issues' });
  const inspected: string[] = [];
  const transport: Transport = (url, opts) => {
    const id = new URL(url).pathname.match(/\/containers\/([^/]+)\/json$/)?.[1];
    if (id) inspected.push(id.replace(/0*abcdef$/, ''));
    return fixtures(url, opts);
  };
  const state = {};
  const poll = () => INTEGRATIONS.portainer.collect({ type: 'portainer', ...WIDGETS.portainer }, createContext({ transport, kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now(), state }));
  await poll();
  assert.deepEqual(inspected.sort(), ['certbot-renew', 'music-assistant', 'wud']);
  inspected.length = 0;
  const again = await poll();
  // only the crashed container, for its live restart count
  assert.deepEqual(inspected, ['music-assistant']);
  assert.equal(again.containers?.failed, 2);
});

test('Docker refuses a socket path; Portainer and Docker on one engine count its containers once', async () => {
  const run = (type: string, shared: Shared, table = TABLES[type]) => INTEGRATIONS[type].collect({ type, ...WIDGETS[type] },
    createContext({ transport: fixtureTransport(table, { scenario: 'calm' }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now(), shared }));
  await assert.rejects(INTEGRATIONS.docker.collect({ type: 'docker', url: 'unix:///var/run/docker.sock' }, createContext({ kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now() })), /http\(s\)/);

  const two: Shared = {};
  await run('portainer', two);
  await run('docker', two);
  assert.deepEqual(Object.keys(two.containers ?? {}).sort(), ['DEMO:DOCKER02:ENGINE', 'DEMO:PORTAINER:ENGINE']);

  // the docker widget pointed at the engine Portainer manages
  const one: Shared = {};
  await run('portainer', one);
  await run('docker', one, { ...FIXTURES.docker, 'GET /info': () => ({ ID: 'DEMO:PORTAINER:ENGINE' }) });
  assert.deepEqual(Object.keys(one.containers ?? {}), ['DEMO:PORTAINER:ENGINE']);
});

test('Pi-hole v6 logs in once and reuses the session, logging in again after a 401', async () => {
  const fixtures = fixtureTransport(FIXTURES.pihole, { scenario: 'calm' });
  let logins = 0;
  let expire = false;
  const transport: Transport = async (url, opts) => {
    if (new URL(url).pathname === '/api/auth') logins++;
    else if (expire) { expire = false; return new Response('{"error":{"key":"unauthorized"}}', { status: 401 }); }
    return fixtures(url, opts);
  };
  const state = {};
  const poll = () => INTEGRATIONS.pihole.collect({ type: 'pihole', ...WIDGETS.pihole }, createContext({ transport, kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now(), state }));
  const first = await poll();
  await poll();
  assert.equal(logins, 1);
  assert.deepEqual(first.dns && [first.dns.queries, first.dns.blockedPct], [31_402, 13.02]);
  expire = true;
  await poll();
  assert.equal(logins, 2);
});

test('Pi-hole v5 and disabled blocking', async () => {
  const run = (scenario: string, w: Partial<Widget>) => INTEGRATIONS.pihole.collect({ type: 'pihole', ...WIDGETS.pihole, ...w }, createContext({ transport: fixtureTransport(FIXTURES.pihole, { scenario }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now() }));
  const v5 = await run('calm', { version: 5 });
  assert.equal(v5.dns?.queries, 31_402);
  assert.deepEqual(v5.alerts, []);
  assert.deepEqual((await run('issues', { version: 5 })).alerts.map((a) => a.title), ['Blocking is disabled']);
  assert.deepEqual((await run('issues', {})).alerts.map((a) => a.title), ['Blocking is disabled']);
  await assert.rejects(run('calm', { version: 5, key: '' }), /API token/);
});

test('customapi: paths, formats, remap, scale', () => {
  assert.deepEqual(fieldPath('a.b.0.c'), ['a', 'b', '0', 'c']);
  assert.deepEqual(fieldPath({ a: { b: 'c' } }), ['a', 'b', 'c']);
  assert.deepEqual(fieldPath({ a: { b: 'c.d' } }), ['a', 'b', 'c', 'd']);
  const now = Date.UTC(2026, 0, 10, 12);
  const f = (raw: Json, m: Omit<CustomApiMapping, 'field'>) => formatValue(raw, { field: 'x', ...m }, now);
  assert.equal(f('hi', {}), 'hi');
  assert.equal(f(12345.678, { format: 'number' }), '12,346');
  assert.equal(f(1.23456, { format: 'float' }), '1.23');
  assert.equal(f(42.25, { format: 'percent' }), '42.3%');
  assert.equal(f(1536, { format: 'bytes' }), '1.5 KiB');
  assert.equal(f(12_500_000, { format: 'bitrate' }), '12.5 Mbit/s');
  assert.equal(f(3720, { format: 'duration' }), '1 h 02 m');
  assert.equal(f('2026-01-03T12:00:00Z', { format: 'date' }), '3 Jan 2026');
  assert.equal(f(now - 3 * 3600_000, { format: 'relativeDate' }), '3 h ago');
  assert.equal(f([1, 2, 3], { format: 'size' }), '3');
  assert.equal(f(2048, { scale: '1/1024', suffix: ' KiB' }), '2 KiB');
  assert.equal(f(0.5, { scale: 100, format: 'percent' }), '50%');
  assert.equal(f(7, { prefix: '#' }), '#7');
  assert.equal(f(1, { remap: [{ value: 1, to: 'on' }, { any: true, to: 'off' }] }), 'on');
  assert.equal(f(3, { remap: [{ value: 1, to: 'on' }, { any: true, to: 'off' }] }), 'off');
});

test('customapi: thresholds compare the scaled raw value', () => {
  assert.equal(crossed(91, { above: 90 }), true);
  assert.equal(crossed(90, { above: 90 }), false);
  assert.equal(crossed(false, { below: 1 }), true);
  assert.equal(crossed('down', { equals: 'down' }), true);
  assert.equal(crossed('up', { not: 'up' }), false);
  assert.equal(crossed(null, { below: 1 }), false);
  assert.equal(crossed(5, undefined), false);
});

test('customapi: alerts for crossed thresholds and missing fields; refreshInterval', async () => {
  const run = (scenario: string, w: WidgetOptions = WIDGETS.customapi, state: Record<string, unknown> = {}, now: number = Date.now()) => INTEGRATIONS.customapi.collect({ type: 'customapi', ...w },
    createContext({ transport: fixtureTransport(FIXTURES.customapi, { scenario }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now, state }));
  const calm = await run('calm');
  assert.deepEqual(calm.stats.map((x) => [x.k, x.v, x.level]), [['sessions', '3', null], ['items', '2,841', null], ['health', 'OK', null]]);
  assert.equal(calm.line, 'sessions 3');
  assert.deepEqual(calm.alerts, []);

  const issues = await run('issues');
  assert.deepEqual(issues.alerts.map((a) => [a.sev, a.title, a.detail]), [['crit', 'Health is Degraded', 'critical when below 1']]);
  assert.equal(issues.stats[2].level, 'crit');

  const missing = await run('calm', { ...WIDGETS.customapi, mappings: [{ field: 'library.nope', label: 'x', warn: { above: 1 } }] });
  assert.deepEqual(missing.stats, [{ k: 'x', v: '—', level: 'warn' }]);
  assert.deepEqual(missing.alerts.map((a) => [a.sev, a.title]), [['warn', 'Field library.nope not found']]);

  // a second poll inside refreshInterval returns the last result without a request
  const state = {};
  const t0 = Date.now();
  await run('calm', { ...WIDGETS.customapi, refreshInterval: 300_000 }, state, t0);
  const again = await run('issues', { ...WIDGETS.customapi, refreshInterval: 300_000 }, state, t0 + 120_000);
  assert.deepEqual(again.alerts, []);
  assert.equal((await run('issues', { ...WIDGETS.customapi, refreshInterval: 300_000 }, state, t0 + 300_000)).alerts.length, 1);
});

test('customapi: a non-JSON answer is an error with the body for the log only', async () => {
  const transport = async () => new Response('<html>login</html>', { status: 200 });
  const err = await INTEGRATIONS.customapi.collect({ type: 'customapi', url: 'https://x.test/' }, createContext({ transport, kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now() }))
    .then(() => null, (e: Error & { body?: string }) => e);
  assert.equal(err?.message, 'Response is not JSON');
  assert.equal(err?.body, '<html>login</html>');
  const post: { method: string; headers: Record<string, string>; body: string } = { method: '', headers: {}, body: '' };
  const record: Transport = async (url, opts = {}) => (Object.assign(post, opts), Response.json({ ok: 1 }));
  await INTEGRATIONS.customapi.collect({ type: 'customapi', url: 'https://x.test/', method: 'post', requestBody: { q: 1 }, username: 'u', password: 'p', mappings: [{ field: 'ok' }] },
    createContext({ transport: record, kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now() }));
  assert.deepEqual([post.method, post.body, post.headers['Content-Type'], post.headers.Authorization], ['POST', '{"q":1}', 'application/json', 'Basic dTpw']);
});

test('OMV: services, updates and the fullest data disk, not the largest', async () => {
  const run = (scenario: string) => INTEGRATIONS.openmediavault.collect({ type: 'openmediavault', ...WIDGETS.openmediavault },
    createContext({ transport: fixtureTransport(FIXTURES.openmediavault, { scenario }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now() }));
  const stats = (r: WidgetResult) => Object.fromEntries(r.stats.map((s) => [s.k, [s.v, s.level ?? null]]));
  const calm = await run('calm');
  assert.deepEqual(stats(calm), { services: ['3 / 3', null], updates: ['0', null], storage: ['71%', 'warn'] });
  assert.deepEqual(calm.alerts, []);
  const issues = await run('issues');
  // scratch (500 GB, 90 %) beats data (8 TB, 71 %)
  assert.deepEqual(stats(issues), { services: ['3 / 3', null], updates: ['4', null], storage: ['90%', 'crit'] });
  assert.deepEqual(issues.alerts.map((a) => a.title), ['4 updates available on nas']);
});

test('OPNsense: WAN rates are text, rounded from 100 Mbit/s up', async () => {
  // ~160 Mbit/s down, ~1 Mbit/s up: the counters grow 20 000 and 125 bytes per ms
  const table: Fixtures = {
    ...FIXTURES.opnsense,
    'GET /api/diagnostics/traffic/interface': ({ now }) => ({ interfaces: { wan: { 'bytes received': String(now * 20_000), 'bytes transmitted': String(now * 125) } } })
  };
  const state = {};
  const poll = (now: number) => INTEGRATIONS.opnsense.collect({ type: 'opnsense', ...WIDGETS.opnsense },
    createContext({ transport: fixtureTransport(table, { scenario: 'calm', now }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now, state }));
  const t0 = Date.now();
  assert.equal((await poll(t0)).line, 'Collecting traffic…');
  const res = await poll(t0 + 60_000);
  assert.deepEqual(res.stats.slice(0, 2).map((s) => s.v), ['160', '1.0']);
  assert.equal(res.line, 'WAN 160 / 1.0 Mbit/s');
});

for (const scenario of ['issues', 'calm']) {
  test(`all integrations collect from the ${scenario} fixtures`, async (t) => {
    const shared = {};
    const types = [...ORDER, ...Object.keys(INTEGRATIONS).filter((x) => !ORDER.includes(x))];
    for (const type of types) {
      await t.test(type, async () => {
        const ctx = createContext({ transport: fixtureTransport(TABLES[type], { scenario }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now(), shared });
        const res = await INTEGRATIONS[type].collect({ type, ...WIDGETS[type] }, ctx);
        assert.ok(Array.isArray(res.stats) && res.stats.length > 0, 'stats');
        assert.ok(res.stats.every((s) => typeof s.v === 'string'), 'stat values are text');
        assert.equal(typeof res.line, 'string');
        assert.ok(Array.isArray(res.alerts), 'alerts');
      });
    }
  });
}
