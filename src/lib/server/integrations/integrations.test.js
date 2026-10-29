// Every integration, in both demo scenarios, against the API fixtures the demo serves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRATIONS, ORDER, createContext } from './index.js';
import { FIXTURES, fixtureTransport } from '../demo/index.js';
import { DEFAULT_SETTINGS } from '../config.js';

const WIDGETS = {
  proxmox: { url: 'https://pve.test:8006', username: 'u@pve!t', password: 's' },
  proxmoxbackupserver: { url: 'https://pbs.test:8007', username: 'u@pbs!t', password: 's' },
  opnsense: { url: 'https://opnsense.test', username: 'k', password: 's' },
  fritzbox: { url: 'http://fritz.test' },
  adguard: { url: 'https://adguard.test', username: 'admin', password: 's' },
  portainer: { url: 'https://portainer.test', env: 1, key: 'k' },
  openmediavault: { url: 'https://nas.test', username: 'admin', password: 's' },
  docker: { url: 'http://socket-proxy.test:2375' },
  pihole: { url: 'https://pihole.test', key: 's' }
};

const memoryKv = () => {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) };
};

test('every integration has a fixture table and a widget here', () => {
  assert.deepEqual(Object.keys(FIXTURES).sort(), Object.keys(INTEGRATIONS).sort());
  assert.deepEqual(Object.keys(WIDGETS).sort(), Object.keys(INTEGRATIONS).sort());
});

test('PBS reports backups made while the dashboard was restarting', async () => {
  const kv = memoryKv();
  const run = (now) => {
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
  const run = async (scenario) => {
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
  /** @type {string[]} */
  const inspected = [];
  /** @type {import('$lib/types').Transport} */
  const transport = (url, opts) => {
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
  const run = (type, shared, table = FIXTURES[type]) => INTEGRATIONS[type].collect({ type, ...WIDGETS[type] },
    createContext({ transport: fixtureTransport(table, { scenario: 'calm' }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now(), shared }));
  await assert.rejects(INTEGRATIONS.docker.collect({ type: 'docker', url: 'unix:///var/run/docker.sock' }, createContext({ kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now() })), /http\(s\)/);

  /** @type {import('$lib/types').Shared} */
  const two = {};
  await run('portainer', two);
  await run('docker', two);
  assert.deepEqual(Object.keys(two.containers ?? {}).sort(), ['DEMO:DOCKER02:ENGINE', 'DEMO:PORTAINER:ENGINE']);

  // the docker widget pointed at the engine Portainer manages
  /** @type {import('$lib/types').Shared} */
  const one = {};
  await run('portainer', one);
  await run('docker', one, { ...FIXTURES.docker, 'GET /info': () => ({ ID: 'DEMO:PORTAINER:ENGINE' }) });
  assert.deepEqual(Object.keys(one.containers ?? {}), ['DEMO:PORTAINER:ENGINE']);
});

test('Pi-hole v6 logs in once and reuses the session, logging in again after a 401', async () => {
  const fixtures = fixtureTransport(FIXTURES.pihole, { scenario: 'calm' });
  let logins = 0;
  let expire = false;
  /** @type {import('$lib/types').Transport} */
  const transport = async (url, opts) => {
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
  const run = (scenario, w) => INTEGRATIONS.pihole.collect({ type: 'pihole', ...WIDGETS.pihole, ...w }, createContext({ transport: fixtureTransport(FIXTURES.pihole, { scenario }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now() }));
  const v5 = await run('calm', { version: 5 });
  assert.equal(v5.dns?.queries, 31_402);
  assert.deepEqual(v5.alerts, []);
  assert.deepEqual((await run('issues', { version: 5 })).alerts.map((a) => a.title), ['Blocking is disabled']);
  assert.deepEqual((await run('issues', {})).alerts.map((a) => a.title), ['Blocking is disabled']);
  await assert.rejects(run('calm', { version: 5, key: '' }), /API token/);
});

for (const scenario of ['issues', 'calm']) {
  test(`all integrations collect from the ${scenario} fixtures`, async (t) => {
    const shared = {};
    const types = [...ORDER, ...Object.keys(INTEGRATIONS).filter((x) => !ORDER.includes(x))];
    for (const type of types) {
      await t.test(type, async () => {
        const ctx = createContext({ transport: fixtureTransport(FIXTURES[type], { scenario }), kv: memoryKv(), settings: DEFAULT_SETTINGS, now: Date.now(), shared });
        const res = await INTEGRATIONS[type].collect(WIDGETS[type], ctx);
        assert.ok(Array.isArray(res.stats) && res.stats.length > 0, 'stats');
        assert.equal(typeof res.line, 'string');
        assert.ok(Array.isArray(res.alerts), 'alerts');
      });
    }
  });
}
