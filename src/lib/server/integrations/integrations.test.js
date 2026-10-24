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
