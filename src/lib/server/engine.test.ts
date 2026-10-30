// The engine's rounds on scripted sources: probes, widgets (errors, label discovery), certificates, heartbeat calls,
// the local host. Rounds are run by hand; nothing is scheduled (load() instead of start()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// CONFIG_DIR and DATA_DIR are read when config.ts is imported; each test writes its own services.yaml
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-engine-'));
process.env.CONFIG_DIR = tmp;
process.env.DATA_DIR = path.join(tmp, 'data');
delete process.env.DEMO;
delete process.env.HOST_NAME;
const { Engine } = await import('./engine.ts');
const { FIXTURES, fixtureTransport } = await import('./demo/index.ts');
const { lastProbes, recentEvents, series } = await import('./db.ts');
const { reasonText } = await import('./http.ts');
import type { HostVitals, ProbeResult, Snapshot, Sources, Transport } from '$lib/types';

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const notFound: Transport = async () => new Response('', { status: 404 });
/** Sources where nothing answers; a test replaces what it needs. */
const script = (over: Partial<Sources> = {}): Sources => ({ probe: () => ({ ok: true, ms: 10, code: 200 }), cert: () => null, local: () => null, temps: () => null, transport: () => notFound, iconTransport: notFound, seed: () => {}, ...over });
/** An engine on these services (services.yaml text) and sources, loaded but not started. */
function engine(yaml: string, sources: Sources) {
  fs.writeFileSync(path.join(tmp, 'services.yaml'), yaml);
  const e = new Engine(sources);
  e.load();
  return e;
}
const snap = (e: InstanceType<typeof Engine>) => (e.snapshot as Snapshot);
const tile = (e: InstanceType<typeof Engine>, name: string) => snap(e).groups.flatMap((g) => g.services).find((t) => t.name === name);
const titles = (sid: string) => recentEvents(0, 100).filter((e) => e.sid === sid).reverse().map((e) => e.title);
// background work a round starts without awaiting it (discovery probes new services)
const settle = () => new Promise((r) => setTimeout(r, 20));

test('probe rounds: down after two failures, back up with one event each way', async () => {
  let up = false;
  const refused: ProbeResult = { ok: false, ms: null, code: 'ECONNREFUSED' };
  const e = engine('- Apps:\n    - Web:\n        siteMonitor: https://web.home.arpa\n', script({ probe: () => (up ? { ok: true, ms: 12, code: 200 } : refused) }));
  assert.equal(tile(e, 'Web')?.status, 'Checking');
  await e.runProbes();
  assert.equal(tile(e, 'Web')?.status, 'Up', 'one failure is not down yet');
  await e.runProbes();
  assert.deepEqual([tile(e, 'Web')?.status, tile(e, 'Web')?.level], ['Down', 'crit']);
  up = true;
  await e.runProbes();
  assert.equal(tile(e, 'Web')?.status, 'Up');
  assert.deepEqual(titles('apps-web'), ['Web went down', 'Web recovered']);
  assert.equal(lastProbes('apps-web', 10).length, 3);
});

test('widget rounds: a failed poll keeps the last stats, says why, and logs the body only', async () => {
  let fail = false;
  const fixtures = fixtureTransport(FIXTURES.adguard, { scenario: 'calm' });
  const transport: Transport = async (url, opts) => {
    if (!fail) return fixtures(url, opts);
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' }, body: 'upstream-body-s3cret' });
  };
  const e = engine('- Network:\n    - AdGuard:\n        widget: { type: adguard, url: "https://adguard.home.arpa", username: admin, password: p }\n', script({ transport: () => transport }));
  await e.runWidgets();
  const st = e.state('network-adguard');
  const stats = st.widget?.stats;
  assert.equal(st.widget?.ok, true);
  assert.ok(stats?.length);

  fail = true;
  await e.runWidgets();
  assert.deepEqual([st.widget?.ok, st.widget?.error, st.widget?.stats], [false, reasonText('ECONNREFUSED'), stats]);
  assert.deepEqual(snap(e).attention.filter((a) => a.service === 'AdGuard').map((a) => [a.sev, a.title, a.detail]), [['info', 'AdGuard: stats unavailable', reasonText('ECONNREFUSED')]]);
  assert.equal(tile(e, 'AdGuard')?.line, 'Stats unavailable');
  assert.ok(!JSON.stringify(snap(e)).includes('upstream-body-s3cret'));
});

test('label discovery: discovered services join the config, their containers are checks; a failed poll keeps them', async () => {
  let fail = false;
  const fixtures = fixtureTransport(FIXTURES.portainer, { scenario: 'issues' });
  const transport: Transport = async (url, opts) => (fail ? notFound(url, opts) : fixtures(url, opts));
  const e = engine('- Infra:\n    - Portainer:\n        widget: { type: portainer, url: "https://portainer.home.arpa", env: 1, key: k }\n', script({ transport: () => transport }));
  await e.runWidgets();
  await settle();
  const names = () => e.cfg.services.map((s) => s.name).sort();
  assert.deepEqual(names(), ['Portainer', 'Traefik', "What's Up Docker"]);
  const wud = tile(e, "What's Up Docker");
  assert.deepEqual([wud?.status, wud?.level], ['Down', 'crit'], 'its container exited: checked by its state');
  assert.equal(tile(e, 'Traefik')?.status, 'Up', 'a siteMonitor label makes it a probe');

  fail = true;
  await e.runWidgets();
  assert.deepEqual(names(), ['Portainer', 'Traefik', "What's Up Docker"]);
});

test('certificates: a renewal is one event, and the baseline outlives the engine', async () => {
  const D = 86_400_000;
  const yaml = '- Apps:\n    - Mail:\n        siteMonitor: https://mail.home.arpa\n';
  const cert = (validTo: number) => script({ cert: () => ({ validTo, trusted: true, selfSigned: false }) });
  const first = engine(yaml, cert(Date.now() + 10 * D));
  await first.runCerts();
  await first.runCerts();
  assert.equal(tile(first, 'Mail')?.cert?.days, 9);
  assert.deepEqual(titles('apps-mail'), []);

  const restarted = engine(yaml, cert(Date.now() + 90 * D));
  await restarted.runCerts();
  assert.deepEqual(titles('apps-mail'), ['Certificate renewed']);
});

test('heartbeat calls: token checked, the tile updates at once, no history row from a call', async () => {
  const e = engine('- Jobs:\n    - Restic:\n        heartbeat: { every: 24h, token: tok }\n', script());
  e.heartbeatLimit = () => true;
  assert.equal(tile(e, 'Restic')?.status, 'Waiting');
  assert.equal(e.heartbeat('jobs-restic', 'wrong', true), 404);
  assert.equal(e.heartbeat('jobs-restic', 'tok', true), 200);
  assert.deepEqual([tile(e, 'Restic')?.status, tile(e, 'Restic')?.line.startsWith('Last run')], ['Up', true]);
  await settle(); // a failure counts when it came after the last success; the engine reads the clock itself
  assert.equal(e.heartbeat('jobs-restic', 'tok', false, 'disk full'), 200);
  assert.deepEqual(snap(e).attention.map((a) => [a.sev, a.title]), [['crit', 'Restic reported a failure']]);
  assert.deepEqual(lastProbes('jobs-restic', 10), []);
});

test('without a Proxmox widget the System panel shows the local host; temperatures from the sources', async () => {
  const GiB = 1024 ** 3;
  const local: HostVitals = { node: 'box', cpu: 23, cpus: 8, mem: 4 * GiB, maxmem: 16 * GiB, memPct: 25, disk: { name: '/', pct: 40, sub: '40 / 100 GiB' }, uptime: '3 d', guestsRunning: null, guestsTotal: null, updates: null };
  const e = engine('- Apps:\n    - Wiki:\n        href: https://wiki.home.arpa\n', script({ local: () => local, temps: () => ({ cpu: 51, nvme: [], drives: [] }) }));
  await e.runWidgets();
  assert.deepEqual(snap(e).host?.gauges.map((g) => [g.key, g.val]), [['cpu', 23], ['mem', '4.0'], ['disk', 40], ['temp', 51]]);
  const now = Date.now();
  assert.deepEqual([series('host.cpu', 0, now, 1).values, series('host.mem', 0, now, 1).values, series('host.temp', 0, now, 1).values], [[23], [25], [51]]);
});
