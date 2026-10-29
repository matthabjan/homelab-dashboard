// Automatic icons against small stand-ins for the selfh.st and dashboard-icons indexes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIconFinder, iconCandidates, svgLuminance } from './icons.js';

const SH = 'https://cdn.jsdelivr.net/gh/selfhst/icons';
const DI = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons';

/** @type {Record<string, any>} */
const FILES = {
  [`${SH}/index.json`]: [
    { Reference: 'traefik', SVG: 'Yes', Light: 'Yes' },
    { Reference: 'lldap', SVG: 'Yes', Light: 'Yes' },
    { Reference: 'ddns-updater', SVG: 'No', Light: 'No' },
    { Reference: 'music-assistant', SVG: 'Yes', Light: 'No' }
  ],
  [`${DI}/metadata.json`]: {
    traefik: { base: 'svg' },
    'whats-up-docker': { base: 'png' },
    vaultwarden: { base: 'svg', colors: { light: 'vaultwarden-light', dark: 'vaultwarden' } }
  },
  [`${SH}/svg/traefik.svg`]: '<svg><path style="fill:#24a1c1"/></svg>',
  [`${SH}/svg/lldap.svg`]: '<svg><path style="fill:#212529"/></svg>',
  [`${DI}/svg/vaultwarden.svg`]: '<svg><path d="M0"/></svg>',
  [`${DI}/svg/vaultwarden-light.svg`]: '<svg><path fill="#fafafa"/></svg>'
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

test('selfh.st first; a nearly black icon gets its -light variant for dark mode', async () => {
  const { icons } = finder();
  await icons.refresh();
  assert.deepEqual(await icons.find(['traefik']), { icon: `${SH}/svg/traefik.svg`, iconDark: null });
  assert.deepEqual(await icons.find(['lldap']), { icon: `${SH}/svg/lldap.svg`, iconDark: `${SH}/svg/lldap-light.svg` });
  assert.deepEqual(await icons.find(['ddns-updater']), { icon: `${SH}/png/ddns-updater.png`, iconDark: null });
});

test('dashboard-icons: the variant that is actually light, whatever it is called', async () => {
  const { icons } = finder();
  await icons.refresh();
  assert.deepEqual(await icons.find(['vaultwarden']), { icon: `${DI}/svg/vaultwarden.svg`, iconDark: `${DI}/svg/vaultwarden-light.svg` });
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
  delete files[`${SH}/svg/lldap.svg`];
  const { icons } = finder(files);
  await icons.refresh();
  assert.equal((await icons.find(['lldap']))?.iconDark, null);
  files[`${SH}/svg/lldap.svg`] = FILES[`${SH}/svg/lldap.svg`];
  assert.equal((await icons.find(['lldap']))?.iconDark, `${SH}/svg/lldap-light.svg`);
});
