// Config files with mistakes: a typo or a wrong shape keeps the last version that loaded instead of emptying the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// CONFIG_DIR is read when config.js is imported
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-config-'));
process.env.CONFIG_DIR = dir;
const { loadConfig } = await import('./config.js');

const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
const names = (cfg) => cfg.services.map((s) => s.name);

const SERVICES = `
- Infra:
    - Proxmox:
        href: https://pve.home.arpa:8006
    - NAS:
        href: https://nas.home.arpa
`;

test('config files with mistakes', async (t) => {
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await t.test('valid files load without problems', () => {
    write('services.yaml', SERVICES);
    write('settings.yaml', 'title: Lab\n');
    const cfg = loadConfig();
    assert.deepEqual(names(cfg), ['Proxmox', 'NAS']);
    assert.equal(cfg.settings.title, 'Lab');
    assert.deepEqual(cfg.problems, []);
  });

  await t.test('a typo keeps the last version and names the line, without the file content', () => {
    write('services.yaml', SERVICES + '    - Broken:\n      href: [unclosed  # token: s3cr3t\n');
    const cfg = loadConfig();
    assert.deepEqual(names(cfg), ['Proxmox', 'NAS']);
    assert.equal(cfg.problems.length, 1);
    const [p] = cfg.problems;
    assert.equal(p.file, 'services.yaml');
    assert.equal(p.fallback, 'last');
    assert.match(p.message, /^line \d+: /);
    assert.doesNotMatch(p.message, /s3cr3t|\n/);
  });

  await t.test('a file that never loaded falls back to empty', () => {
    write('bookmarks.yaml', '- Links:\n    - Docs: [\n');
    const cfg = loadConfig();
    const p = cfg.problems.find((x) => x.file === 'bookmarks.yaml');
    assert.equal(p?.fallback, 'none');
    assert.deepEqual(cfg.bookmarks, []);
    fs.rmSync(path.join(dir, 'bookmarks.yaml'));
  });

  await t.test('the wrong shape keeps the last version', () => {
    write('services.yaml', 'Infra:\n  - Proxmox: {}\n');
    write('settings.yaml', '- title: Lab\n');
    const cfg = loadConfig();
    assert.deepEqual(names(cfg), ['Proxmox', 'NAS']);
    assert.equal(cfg.settings.title, 'Lab');
    assert.deepEqual(cfg.problems.map((p) => [p.file, p.message, p.fallback]), [
      ['settings.yaml', 'should be a mapping of settings', 'last'],
      ['services.yaml', 'should be a list of groups', 'last']
    ]);
  });

  await t.test('a bad group or entry is skipped, the rest loads', () => {
    write('settings.yaml', 'title: Lab\n');
    write('services.yaml', SERVICES + '- Apps: not a list\n- just text\n- Media:\n    - Jellyfin: {}\n    - {}\n');
    const cfg = loadConfig();
    assert.deepEqual(names(cfg), ['Proxmox', 'NAS', 'Jellyfin']);
    assert.deepEqual(cfg.problems.map((p) => [p.message, p.fallback]), [
      ['group "Apps" is not a list, skipped', null],
      ['entry 3 is not a group (`- Group: [...]`), skipped', null],
      ['an entry in group "Media" has no name, skipped', null]
    ]);
  });

  await t.test('a docker widget on a socket instead of a proxy URL is a problem', () => {
    write('services.yaml', SERVICES + '- Docker:\n    - Box:\n        widget:\n          type: docker\n          url: unix:///var/run/docker.sock\n');
    assert.deepEqual(loadConfig().problems.map((p) => p.message), ['"Box": a docker widget needs an http(s):// url (a socket proxy, see docs/integrations.md#docker)']);
  });

  await t.test('heartbeats: durations, default grace and id; no token or a duplicate id is a problem', () => {
    process.env.HB_TEST = 'tok';
    write('services.yaml', `
- Backups:
    - Nightly restic:
        siteMonitor: https://ignored.home.arpa
        heartbeat: { every: 24h, token: "\${HB_TEST}", backup: true }
    - Borg:
        heartbeat: { every: 30m, grace: 2m, token: x, id: Backups nightly restic }
    - Kopia:
        heartbeat: { every: 1d }
    - Cron:
        heartbeat: { every: soon, token: x }
`);
    const cfg = loadConfig();
    const hb = (n) => cfg.services.find((s) => s.name === n)?.heartbeat;
    assert.deepEqual(hb('Nightly restic'), { id: 'backups-nightly-restic', every: 86_400_000, grace: 8_640_000, token: 'tok', backup: true });
    assert.equal(cfg.services[0].probe, null, 'the heartbeat is the check');
    assert.equal(hb('Borg'), null);
    assert.equal(hb('Kopia'), null);
    assert.deepEqual(cfg.problems.map((p) => p.message), [
      '"Borg": heartbeat id "backups-nightly-restic" is used twice',
      '"Kopia": heartbeat needs a token',
      '"Cron": heartbeat needs `every` (such as 24h, 30m)'
    ]);
    delete process.env.HB_TEST;
  });

  await t.test('fixing the file clears the problem; a removed file is simply empty', () => {
    write('services.yaml', SERVICES);
    assert.deepEqual(loadConfig().problems, []);
    fs.rmSync(path.join(dir, 'services.yaml'));
    const cfg = loadConfig();
    assert.deepEqual(names(cfg), []);
    assert.deepEqual(cfg.problems, []);
  });
});
