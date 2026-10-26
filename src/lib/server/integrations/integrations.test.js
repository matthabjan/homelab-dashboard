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
  openmediavault: { url: 'https://nas.test', username: 'admin', password: 's' }
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
