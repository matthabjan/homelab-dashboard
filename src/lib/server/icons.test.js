// Automatic icons against small stand-ins for the selfh.st and dashboard-icons indexes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIconFinder, iconCandidates, svgLuminance } from './icons.js';

const SH = 'https://cdn.jsdelivr.net/gh/selfhst/icons@main';
const DI = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main';

/** @type {Record<string, any>} */
const FILES = {
  [`${SH}/index.json`]: [
    { Reference: 'traefik', SVG: 'Yes', Light: 'Yes', Dark: 'Yes' },
    { Reference: 'lldap', SVG: 'Yes', Light: 'Yes', Dark: 'No' },
    { Reference: 'umami', SVG: 'Yes', Light: 'No', Dark: 'Yes' },
    { Reference: 'opnsense', SVG: 'Yes', Light: 'Yes', Dark: 'Yes' },
    { Reference: 'ddns-updater', SVG: 'No', Light: 'No' },
    { Reference: 'ghost', SVG: 'No', Light: 'Yes' },
    { Reference: 'music-assistant', SVG: 'Yes', Light: 'No' }
  ],
  [`${DI}/metadata.json`]: {
    traefik: { base: 'svg' },
    'whats-up-docker': { base: 'png' },
    vaultwarden: { base: 'svg', colors: { light: 'vaultwarden-light', dark: 'vaultwarden' } },
    proxmox: { base: 'svg', colors: { dark: 'proxmox', light: 'proxmox-light' } },
    gitea: { base: 'svg', colors: { dark: 'gitea-dark' } },
    nas: { base: 'svg', colors: { light: 'nas-light', dark: 'nas' } }
  },
  [`${SH}/svg/traefik.svg`]: '<svg><path style="fill:#24a1c1"/></svg>',
  [`${SH}/svg/opnsense.svg`]: '<svg><path style="fill:#de3c07"/></svg>',
  [`${SH}/svg/lldap.svg`]: '<svg><path style="fill:#212529"/></svg>',
  [`${SH}/svg/umami.svg`]: '<svg><path fill="white"/></svg>',
  [`${DI}/svg/nas.svg`]: '<svg><path fill="#f5f5f5"/></svg>',
  [`${DI}/svg/nas-light.svg`]: '<svg><path fill="#222"/></svg>',
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

test('luminance: darkest and brightest paint, unpainted is black', () => {
  assert.deepEqual(svgLuminance('<svg><path d="M0"/></svg>'), { min: 0, max: 0 });
  const l = svgLuminance('<path fill="#212529"/><path fill="#fff"/>');
  assert.ok(l.min < 0.05 && l.max > 0.9);
  assert.ok(svgLuminance('<stop stop-color="#e57000"/>').max > 0.2);
});

test('selfh.st first; the icon itself in both themes unless it would vanish in one', async () => {
  const { icons, calls } = finder();
  await icons.refresh();
  assert.deepEqual(await icons.find(['traefik']), { icon: `${SH}/svg/traefik.svg`, iconDark: null });
  assert.deepEqual(await icons.find(['opnsense']), { icon: `${SH}/svg/opnsense.svg`, iconDark: null }); // dark orange still shows
  assert.deepEqual(await icons.find(['lldap']), { icon: `${SH}/svg/lldap.svg`, iconDark: `${SH}/svg/lldap-light.svg` });
  assert.deepEqual(await icons.find(['umami']), { icon: `${SH}/svg/umami-dark.svg`, iconDark: `${SH}/svg/umami.svg` });
  assert.deepEqual(await icons.find(['ghost']), { icon: `${SH}/png/ghost.png`, iconDark: null });
  assert.deepEqual(await icons.find(['ddns-updater']), { icon: `${SH}/png/ddns-updater.png`, iconDark: null });
  assert.ok(!calls.some((u) => /-(light|dark)\.svg$/.test(u))); // selfh.st variants are taken by name, not fetched
});

test('dashboard-icons: variants judged by colour, whatever they are called', async () => {
  const { icons } = finder();
  await icons.refresh();
  assert.deepEqual(await icons.find(['vaultwarden']), { icon: `${DI}/svg/vaultwarden.svg`, iconDark: `${DI}/svg/vaultwarden-light.svg` });
  assert.deepEqual(await icons.find(['nas']), { icon: `${DI}/svg/nas-light.svg`, iconDark: `${DI}/svg/nas.svg` });
  assert.deepEqual(await icons.find(['proxmox']), { icon: `${DI}/svg/proxmox.svg`, iconDark: null });
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
