// The /config page data: no configured secret may appear in it anywhere; missing secrets are named; widget rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// CONFIG_DIR and DATA_DIR are read when config.ts is imported
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-config-view-'));
process.env.CONFIG_DIR = dir;
process.env.DATA_DIR = path.join(dir, 'data');
process.env.SECRETS_DIR = path.join(dir, 'secrets');
delete process.env.DEMO;
const { loadConfig, withDiscovered } = await import('./config.ts');
const { buildConfigView, iconName, originOf } = await import('./config-view.ts');
const { blankCheck } = await import('./check.ts');
import type { ServiceState } from '$lib/types';
import type { ConfigViewInput } from './config-view.ts';

// every secret is distinctive, so a substring search can't miss one
const SECRETS = {
  CV_PVE: 'pve-s3cret-0001', CV_PBS: 'pbs-s3cret-0002', CV_OPN_KEY: 'opn-key-0003', CV_OPN_SECRET: 'opn-s3cret-0004', CV_OMV: 'omv-s3cret-0005',
  CV_ADGUARD: 'adg-s3cret-0006', CV_PORTAINER: 'ptr-key-0007', CV_PIHOLE: 'pih-s3cret-0008', CV_HEADER: 'hdr-token-0009', CV_BODY: 'body-s3cret-0010',
  CV_USERINFO: 'userinfo-s3cret-0011', CV_QUERY: 'query-token-0012', CV_HB: 'heartbeat-token-0013', CV_BASIC: 'basic-s3cret-0014', CV_USER: 'user-name-0015'
};
Object.assign(process.env, SECRETS);

fs.writeFileSync(path.join(dir, 'settings.yaml'), 'title: Lab\n');
fs.writeFileSync(path.join(dir, 'services.yaml'), `
- Infra:
    - PVE:
        siteMonitor: https://\${CV_USER}:\${CV_USERINFO}@pve.home.arpa:8006/path?token=\${CV_QUERY}
        widget: { type: proxmox, url: "https://pve.home.arpa:8006/api?ticket=\${CV_QUERY}", username: "\${CV_USER}", password: "\${CV_PVE}", node: pve }
    - PBS:
        widget: { type: proxmoxbackupserver, url: https://pbs.home.arpa:8007, username: u, password: "\${CV_PBS}", datastore: main }
    - OPNsense:
        widget: { type: opnsense, url: "https://\${CV_USER}:\${CV_USERINFO}@opnsense.home.arpa", key: "\${CV_OPN_KEY}", secret: "\${CV_OPN_SECRET}", username: k, password: "\${CV_OPN_SECRET}" }
    - NAS:
        widget: { type: openmediavault, url: https://nas.home.arpa, username: admin, password: "\${CV_OMV}" }
    - SSH:
        siteMonitor: tcp://nas.home.arpa:22
- Network:
    - AdGuard:
        widget: { type: adguard, url: https://adguard.home.arpa, username: admin, password: "\${CV_ADGUARD}" }
    - Pi-hole:
        widget: { type: pihole, url: https://pihole.home.arpa, key: "\${CV_PIHOLE}", version: 6 }
- Apps:
    - Portainer:
        widget: { type: portainer, url: https://portainer.home.arpa, env: 1, key: "\${CV_PORTAINER}" }
    - API:
        widget:
          type: customapi
          url: https://api.home.arpa/v1/status?apikey=\${CV_QUERY}
          method: POST
          headers: { X-Api-Key: "\${CV_HEADER}", Authorization: "Bearer \${CV_HEADER}" }
          requestBody: { secret: "\${CV_BODY}" }
          username: "\${CV_USER}"
          password: "\${CV_BASIC}"
          mappings: [{ field: a, label: a }]
    - Unknown:
        widget: { type: grafana, url: https://grafana.home.arpa, key: "\${CV_HEADER}" }
- Backups:
    - Restic:
        heartbeat: { every: 24h, token: "\${CV_HB}", backup: true }
    - Borg:
        heartbeat: { every: 24h, token: "\${CV_NOT_SET_ANYWHERE}" }
`);

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A small engine: config, one widget that worked and one that failed, a label service, an automatic icon. */
function fakeEngine() {
  const base = loadConfig();
  // label values reach the page only as group and name; this one carries a secret in its widget and href
  const discovered = [{ group: 'Apps', name: 'Labelled', def: { href: `https://x.home.arpa/?k=${SECRETS.CV_QUERY}`, widget: { type: 'adguard', url: `https://u:${SECRETS.CV_USERINFO}@adg2.home.arpa`, password: SECRETS.CV_ADGUARD } }, container: { state: 'running', health: null, exitCode: 0, done: false }, image: null }];
  const cfg = withDiscovered(base, discovered);
  const portainer = cfg.services.find((s) => s.name === 'Portainer');
  const states = new Map<string, ServiceState>();
  const state = (id: string | undefined) => {
    let st = states.get(String(id));
    if (!st) states.set(String(id), (st = { check: blankCheck(), widget: null, wstate: { session: { sid: SECRETS.CV_PIHOLE } }, cert: null }));
    return st;
  };
  state(cfg.services.find((s) => s.name === 'PVE')?.id).widget = { ok: true, ts: 5, lastOk: 5, stats: [], line: '', alerts: [] };
  state(cfg.services.find((s) => s.name === 'NAS')?.id).widget = { ok: false, ts: 9, lastOk: 5, error: 'HTTP 401', stats: [], line: null, alerts: [] };
  const input: ConfigViewInput = {
    cfg,
    state,
    snapshot: null,
    discoveredBy: new Map([[String(portainer?.id), discovered]]),
    autoIcons: new Map([[String(cfg.services.find((s) => s.name === 'SSH')?.id), { icon: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/openssh.svg', iconDark: 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/svg/openssh-light.svg' }]])
  };
  return input;
}

test('no configured secret appears anywhere in the page data', () => {
  const json = JSON.stringify(buildConfigView(fakeEngine()));
  for (const [name, value] of Object.entries(SECRETS)) assert.ok(!json.includes(value), `${name} leaked into the config view`);
  assert.ok(!json.includes('heartbeat-token'), 'heartbeat token');
});

test('missing secrets are named, never valued', () => {
  const view = buildConfigView(fakeEngine());
  assert.deepEqual(view.problems.filter((p) => p.message.startsWith('secret')).map((p) => [p.file, p.message, p.level]), [['services.yaml', 'secret CV_NOT_SET_ANYWHERE is not set', 'warn']]);
  assert.ok(view.problems.some((p) => p.message === '"Borg": heartbeat needs a token'));
});

test('widget rows: type, docs, origin only, safe options, status and source', () => {
  const view = buildConfigView(fakeEngine());
  const row = (name: string) => view.widgets.find((w) => w.name === name);
  assert.deepEqual(row('PVE'), {
    id: 'infra-pve', name: 'PVE', group: 'Infra', type: 'proxmox',
    docs: 'https://github.com/matthabjan/homelab-dashboard/blob/main/docs/integrations.md#proxmox-ve',
    origin: 'https://pve.home.arpa:8006', options: [{ k: 'node', v: 'pve' }], status: 'ok', error: null, lastOk: 5, source: 'services.yaml'
  });
  assert.deepEqual([row('NAS')?.status, row('NAS')?.error, row('NAS')?.lastOk], ['error', 'HTTP 401', 5]);
  assert.equal(row('OPNsense')?.origin, 'https://opnsense.home.arpa');
  assert.deepEqual(row('API')?.options, [{ k: 'method', v: 'POST' }, { k: 'mappings', v: '1' }]);
  assert.equal(row('API')?.origin, 'https://api.home.arpa');
  assert.deepEqual([row('Unknown')?.status, row('Unknown')?.docs], ['unsupported', null]);
  assert.equal(row('Labelled')?.source, 'labels via Portainer');
  assert.equal(row('Pi-hole')?.status, 'never');
});

test('checks, icons and settings', () => {
  const view = buildConfigView(fakeEngine());
  const check = (name: string) => view.checks.find((c) => c.name === name);
  assert.deepEqual([check('PVE')?.kind, check('PVE')?.target], ['http', 'https://pve.home.arpa:8006']);
  assert.deepEqual([check('SSH')?.kind, check('SSH')?.target, check('SSH')?.interval], ['tcp', 'tcp://nas.home.arpa:22', 'every 30 s']);
  assert.deepEqual([check('Restic')?.kind, check('Restic')?.target, check('Restic')?.interval], ['heartbeat', '/api/heartbeat/backups-restic', 'every 24 h + 2 h 24 m grace']);
  assert.equal(check('Labelled')?.kind, 'container');
  assert.deepEqual(view.icons.map((i) => i.yaml), ['icon: sh-openssh.svg\niconDark: sh-openssh-light.svg']);
  assert.ok(view.settings.some((s) => s.k === 'intervals.probe' && s.v === '30'));
  assert.ok(view.settings.some((s) => s.k === 'title' && s.v === 'Lab'));
});

test('origin and icon helpers', () => {
  assert.equal(originOf('https://u:p@h.example.com:8443/a?b=c'), 'https://h.example.com:8443');
  assert.equal(originOf('unix:///var/run/docker.sock'), 'unix:');
  assert.equal(originOf('not a url'), null);
  assert.equal(iconName('https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/png/jellyfin.png'), 'jellyfin.png');
});

test('config problems show as one alert per file, linking to the list', async () => {
  const { createSnapshot } = await import('./snapshot.ts');
  const { snapshotInput } = await import('./test-helpers.ts');
  const items = createSnapshot()(snapshotInput({ cfg: fakeEngine().cfg }), Date.now()).attention.filter((a) => a.key?.startsWith('config-'));
  assert.deepEqual(items.map((a) => [a.sev, a.title, a.href]), [['warn', 'services.yaml has 2 problems', '/config#problems']]);
  assert.match(items[0].detail ?? '', /, and 1 more$/);
});
