// Automatic icons against small stand-ins for the selfh.st and dashboard-icons indexes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIconFinder, iconCandidates, svgLuminance } from './icons.js';

const SH = 'https://cdn.jsdelivr.net/gh/selfhst/icons@main';
const DI = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main';

/** @type {Record<string, any>} */
const FILES = {
  [`${SH}/index.json`]: [
    { Reference: 'traefik', SVG: 'Yes', Light: 'Yes' },
    { Reference: 'lldap', SVG: 'Yes', Light: 'Yes' },
    { Reference: 'ddns-updater', SVG: 'No', Light: 'No' },
    { Reference: 'ghost', SVG: 'No', Light: 'Yes' },
    { Reference: 'music-assistant', SVG: 'Yes', Light: 'No' }
  ],
  [`${DI}/metadata.json`]: {
    traefik: { base: 'svg' },
    'whats-up-docker': { base: 'png' },
    vaultwarden: { base: 'svg', colors: { light: 'vaultwarden-light', dark: 'vaultwarden' } },
    proxmox: { base: 'svg', colors: { dark: 'proxmox', light: 'proxmox-light' } },
    gitea: { base: 'svg', colors: { dark: 'gitea-dark' } }
  },
  [`${DI}/svg/vaultwarden.svg`]: '<svg><path d="M0"/></svg>',
  [`${DI}/svg/vaultwarden-light.svg`]: '<svg><path fill="#fafafa"/></svg>',
  [`${DI}/svg/proxmox.svg`]: '<svg><path fill="#e57000"/><path fill="#000"/></svg>',
  [`${DI}/svg/proxmox-light.svg`]: '<svg><path fill="#e57000"/><path fill="#fff"/></svg>',
  [`${DI}/svg/gitea.svg`]: '<svg><path fill="#609926"/><path fill="#fff"/></svg>',
  [`${DI}/svg/gitea-dark.svg`]: '<svg><path fill="#609926"/></svg>'
};

const memoryKv = () => {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) };
};

function finder(files = FILES) {
  const calls = [];
  const transport = async (url) => {
    calls.push(url);
    const f = files[url];
    return f === undefined ? new Response('', { status: 404 }) : new Response(typeof f === 'string' ? f : JSON.stringify(f));
  };
  return { calls, icons: createIconFinder({ kv: memoryKv(), transport }) };
}

test('candidates: service name, then image repo with and without a -server suffix', () => {
  assert.deepEqual(iconCandidates("What's Up Docker", 'ghcr.io/immich-app/immich-server:v2@sha256:ab'), ['whats-up-docker', 'immich-server', 'immich', 'whats-up', 'whats']);
  assert.deepEqual(iconCandidates('Jellyfin', 'lscr.io/linuxserver/jellyfin:latest'), ['jellyfin']);
  assert.deepEqual(iconCandidates('Media', 'sha256:0123'), ['media']);
});

test('candidates: then the widget type, then the leading words of the name', () => {
  assert.deepEqual(iconCandidates('Proxmox VE', null, 'proxmox'), ['proxmox-ve', 'proxmox']);
  assert.deepEqual(iconCandidates('Proxmox PBS', null, 'proxmoxbackupserver'), ['proxmox-pbs', 'proxmox-backup-server', 'proxmox']);
  assert.deepEqual(iconCandidates('OPNsense Firewall', null, 'opnsense'), ['opnsense-firewall', 'opnsense']);
  assert.deepEqual(iconCandidates('TP-Link Deco X50'), ['tp-link-deco-x50', 'tp-link-deco', 'tp-link']);
  assert.deepEqual(iconCandidates('MusicAssistant'), ['musicassistant', 'music-assistant', 'music']);
  assert.deepEqual(iconCandidates('Stats', null, 'customapi'), ['stats']);
});

test('luminance: brightest paint wins, unpainted is black', () => {
  assert.equal(svgLuminance('<svg><path d="M0"/></svg>'), 0);
  assert.ok(svgLuminance('<path fill="#212529"/><path fill="#fff"/>') > 0.9);
  assert.ok(svgLuminance('<stop stop-color="#e57000"/>') > 0.2);
});

test('selfh.st first; its light variant, when it has one, is the dark-mode icon', async () => {
  const { icons, calls } = finder();
  await icons.refresh();
  assert.deepEqual(await icons.find(['traefik']), { icon: `${SH}/svg/traefik.svg`, iconDark: `${SH}/svg/traefik-light.svg` });
  assert.deepEqual(await icons.find(['ghost']), { icon: `${SH}/png/ghost.png`, iconDark: `${SH}/png/ghost-light.png` });
  assert.deepEqual(await icons.find(['ddns-updater']), { icon: `${SH}/png/ddns-updater.png`, iconDark: null });
  assert.equal(calls.length, 2); // the index says so, no icon is fetched
});

test('dashboard-icons: the brightest variant, whatever it is called, if brighter than the icon', async () => {
  const { icons } = finder();
  await icons.refresh();
  assert.deepEqual(await icons.find(['vaultwarden']), { icon: `${DI}/svg/vaultwarden.svg`, iconDark: `${DI}/svg/vaultwarden-light.svg` });
  assert.deepEqual(await icons.find(['proxmox']), { icon: `${DI}/svg/proxmox.svg`, iconDark: `${DI}/svg/proxmox-light.svg` });
  assert.deepEqual(await icons.find(['gitea']), { icon: `${DI}/svg/gitea.svg`, iconDark: null });
  assert.deepEqual(await icons.find(['media', 'whats-up-docker']), { icon: `${DI}/png/whats-up-docker.png`, iconDark: null });
  assert.equal(await icons.find(['nothing']), null);
});

test('names match with or without hyphens', async () => {
  const { icons } = finder();
  await icons.refresh();
  assert.equal((await icons.find(['musicassistant']))?.icon, `${SH}/svg/music-assistant.svg`);
  assert.equal((await icons.find(['whatsupdocker']))?.icon, `${DI}/png/whats-up-docker.png`);
});

test('indexes are fetched once a day; an unreachable CDN means no automatic icons, retried later', async () => {
  const { icons, calls } = finder({});
  await icons.refresh();
  await icons.refresh();
  assert.equal(calls.length, 2); // both indexes, once: the retry waits an hour
  assert.equal(await icons.find(['traefik']), null);
});

test('a failed colour check is retried by the next lookup', async () => {
  const files = { ...FILES };
  delete files[`${DI}/svg/vaultwarden-light.svg`];
  const { icons } = finder(files);
  await icons.refresh();
  assert.equal((await icons.find(['vaultwarden']))?.iconDark, null);
  files[`${DI}/svg/vaultwarden-light.svg`] = FILES[`${DI}/svg/vaultwarden-light.svg`];
  assert.equal((await icons.find(['vaultwarden']))?.iconDark, `${DI}/svg/vaultwarden-light.svg`);
});
