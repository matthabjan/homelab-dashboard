// Loads services.yaml / settings.yaml / bookmarks.yaml from CONFIG_DIR.
// The format is compatible with gethomepage, so existing files can be reused.
// Secrets: write {{HOMEPAGE_VAR_NAME}} or ${NAME}. Values come from the environment variable NAME,
// the file named in NAME_FILE, or the Docker secret /run/secrets/name (lowercase).
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { dockerUrlOk } from './integrations/docker.js';
/** @import { Config, ConfigProblem, Discovered, Heartbeat, Service, Settings } from '$lib/types' */

export const DEMO = !!process.env.DEMO && process.env.DEMO !== '0';
// The image ships a starter config in /config and the full demo config in DEMO_CONFIG_DIR (/app/config.example):
// `docker run -e DEMO=1` shows the demo, unless CONFIG_DIR points elsewhere.
const configDir = path.resolve(process.env.CONFIG_DIR || 'config');
export const CONFIG_DIR = DEMO && process.env.DEMO_CONFIG_DIR && configDir === '/config' ? path.resolve(process.env.DEMO_CONFIG_DIR) : configDir;
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const SECRETS_DIR = process.env.SECRETS_DIR || '/run/secrets';

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  title: 'Homelab',
  theme: 'system', // default for new visitors: system | light | dark (each viewer can switch)
  accent: '#4F8DF7',
  linkTarget: '_blank',
  tlsVerify: true, // verify widget API certificates; set `tlsVerify: false` per service for self-signed ones
  deepLink: null, // { name: Pulse, href: https://pulse.example.com }
  pwa: {
    name: null,
    shortName: null,
    icon192: 'images/android-chrome-192x192.png',
    icon512: 'images/android-chrome-512x512.png',
    appleTouchIcon: 'images/apple-touch-icon.png',
    favicon: 'images/favicon.ico',
    logo: 'images/android-chrome-192x192.png',
    background: '#0A0D12'
  },
  host: {
    source: 'auto', // auto: the Proxmox node when there is a proxmox widget, else this machine (local) | proxmox | local
    name: null, // shown as Node; default: the Proxmox node, else HOST_NAME, else "this host"
    disk: '/', // local host: path whose filesystem the Disk gauge shows
    service: null, // name of the Proxmox service whose node is shown as "host" (default: first proxmox widget)
    node: null,
    temperature: true, // read CPU/NVMe temps from the kernel (works because the LXC shares the host kernel)
    storages: null, // list of PVE storage names in the Storage panel; null = all
    storage: null // PVE storage on the host gauge; null = the largest local one holding guest disks, else root
  },
  network: {
    service: null, // service whose widget provides WAN traffic (default: OPNsense, else FRITZ!Box)
    dns: null // service whose widget provides DNS statistics (default: the first one that reports them)
  },
  mostUsed: {
    count: 4, // tiles in the "Most used" row; 0 hides it
    halfLifeDays: 14 // an open counts half as much after this many days, so the row follows current habits
  },
  intervals: { probe: 30, widgets: 60, cert: 21600 },
  thresholds: {
    backupMaxAgeHours: 26,
    offsiteMaxDetachedDays: 135, // removable PBS datastore not seen attached for this long → reminder
    certWarnDays: 14,
    latencyWarnMs: 250,
    storageAmberPct: 70,
    storageWarnPct: 85,
    tempMinC: 30,
    tempWarnC: 75,
    driveLifeWarnPct: 10, // warn when a drive has this much of its rated endurance left
    driveTempWarnC: 70
  },
  retentionDays: 30
};

const ENV_RE = /\{\{\s*(?:HOMEPAGE_VAR_|HOMEPAGE_FILE_)?([A-Z0-9_]+)\s*\}\}|\$\{([A-Z0-9_]+)\}/g;

const readSecret = (file) => {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
};

// names of the secrets a load couldn't find, per file (loadConfig turns them into problems)
/** @type {Map<string, Set<string>>} */
let missing = new Map();
let reading = '';

/** NAME from the environment, else from the file in NAME_FILE, else from the Docker secret /run/secrets/name. */
function secret(key) {
  if (process.env[key] != null) return process.env[key];
  const v = readSecret(process.env[key + '_FILE'] || path.join(SECRETS_DIR, key.toLowerCase()));
  if (v == null) {
    console.warn(`[config] ${key} is not set (env, ${key}_FILE or ${path.join(SECRETS_DIR, key.toLowerCase())})`);
    if (!missing.has(reading)) missing.set(reading, new Set());
    missing.get(reading)?.add(key);
  }
  return v ?? '';
}

function substitute(str) {
  return str.replace(ENV_RE, (m, a, b) => {
    const key = a ?? b;
    // homepage style: {{HOMEPAGE_VAR_X}} reads env HOMEPAGE_VAR_X first, then X
    const full = m.includes('HOMEPAGE_VAR_') ? 'HOMEPAGE_VAR_' + key : key;
    if (m.includes('HOMEPAGE_FILE_')) {
      const file = process.env['HOMEPAGE_FILE_' + key];
      const v = file ? readSecret(file) : null;
      if (v == null) {
        if (!missing.has(reading)) missing.set(reading, new Set());
        missing.get(reading)?.add('HOMEPAGE_FILE_' + key);
      }
      return v ?? '';
    }
    return process.env[full] ?? secret(key);
  });
}

function walk(v) {
  if (typeof v === 'string') return substitute(v);
  if (Array.isArray(v)) return v.map(walk);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  return v;
}

// the last version of each file that loaded, before secret substitution: a typo keeps it in use instead of emptying the page
const lastGood = new Map();

/**
 * Read one config file. When it can't be parsed or isn't the right shape (`expect`), the last version that
 * loaded stays in use (or `fallback` before any did) and the problem is recorded. Its message keeps only
 * YAML's reason and position: the excerpt of the file that follows could show a secret, so it goes to the log only.
 * @param {string} name @param {'list' | 'map'} expect @param {any} fallback @param {ConfigProblem[]} problems
 */
function readYaml(name, expect, fallback, problems) {
  const file = path.join(CONFIG_DIR, name);
  reading = name;
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8')) ?? fallback;
    if (expect === 'list' ? !Array.isArray(raw) : !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw Object.assign(new Error(expect === 'list' ? 'should be a list of groups' : 'should be a mapping of settings'), { shape: true });
    }
    lastGood.set(name, raw);
  } catch (e) {
    if (e.code === 'ENOENT') { lastGood.delete(name); return walk(fallback); }
    console.error(`[config] ${name}: ${e.message}`);
    const line = e.linePos?.[0]?.line;
    const reason = e.shape || e.linePos ? e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '') : 'cannot be read';
    raw = lastGood.get(name);
    problems.push({ file: name, message: line ? `line ${line}: ${reason}` : reason, fallback: raw ? 'last' : 'none' });
    raw ??= fallback;
  }
  return walk(raw);
}

/**
 * The groups of services.yaml or bookmarks.yaml as [name, entries] pairs; a malformed group or entry is skipped and recorded.
 * @param {any[]} raw @param {string} file @param {ConfigProblem[]} problems
 * @returns {[string, [string, any][]][]}
 */
function groupsOf(raw, file, problems) {
  const skip = (message) => problems.push({ file, message, fallback: null });
  const pair = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.entries(x)[0] : undefined);
  /** @type {[string, [string, any][]][]} */
  const out = [];
  raw.forEach((g, i) => {
    const [gname, items] = pair(g) ?? [];
    if (gname == null) return skip(`entry ${i + 1} is not a group (\`- Group: [...]\`), skipped`);
    if (items != null && !Array.isArray(items)) return skip(`group "${gname}" is not a list, skipped`);
    /** @type {[string, any][]} */
    const entries = [];
    for (const it of items ?? []) {
      const e = pair(it);
      if (e) entries.push(e);
      else skip(`an entry in group "${gname}" has no name, skipped`);
    }
    out.push([gname, entries]);
  });
  return out;
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null ? deepMerge(base[k], v) : v;
  }
  return out;
}

export const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "30m", "6h", "1d", "90s", "2w", or a number of seconds → ms; null when it isn't one. */
export function parseDuration(v) {
  if (typeof v === 'number') return v > 0 ? v * 1000 : null;
  const m = String(v ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/i);
  return m ? Number(m[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2].toLowerCase()] : null;
}

/**
 * A service's `heartbeat:` block with durations in ms. `grace` defaults to 10% of `every`, at least 5 minutes;
 * `id` (the URL path) to the service id. Null when there is no block or `every` isn't a duration.
 * @returns {Heartbeat | null}
 */
function toHeartbeat(def, id) {
  if (!def || typeof def !== 'object') return null;
  const every = parseDuration(def.every);
  if (!every) return null;
  return {
    id: def.id ? slug(String(def.id)) : id,
    every,
    grace: parseDuration(def.grace) ?? Math.max(every * 0.1, 5 * 60_000),
    token: def.token == null ? '' : String(def.token),
    backup: def.backup === true
  };
}

/** @returns {Service} */
function toService(gname, name, def, settings) {
  const id = slug(gname + '-' + name);
  const heartbeat = toHeartbeat(def?.heartbeat, id);
  return {
    id,
    name,
    group: gname,
    href: def?.href ?? null,
    description: def?.description ?? '',
    icon: def?.icon ?? null,
    iconDark: def?.iconDark ?? null,
    // a heartbeat is the service's check: one history, one status
    probe: heartbeat ? null : def?.siteMonitor ?? def?.probe ?? null,
    insecure: def?.tlsVerify === undefined ? !settings.tlsVerify : !def.tlsVerify,
    latencyWarnMs: Number(def?.latencyWarnMs) || null,
    widget: def?.widget ?? null,
    heartbeat
  };
}

/**
 * What is wrong with a service's heartbeat block, if anything; the service then shows as unknown.
 * @param {Service} svc @param {any} def @param {Set<string>} ids heartbeat ids taken so far
 * @returns {string | null}
 */
function heartbeatProblem(svc, def, ids) {
  if (def?.heartbeat == null) return null;
  if (!svc.heartbeat) return `"${svc.name}": heartbeat needs \`every\` (such as 24h, 30m)`;
  if (ids.has(svc.heartbeat.id)) return `"${svc.name}": heartbeat id "${svc.heartbeat.id}" is used twice`;
  ids.add(svc.heartbeat.id);
  // the demo has no secrets set
  return svc.heartbeat.token || DEMO ? null : `"${svc.name}": heartbeat needs a token`;
}

/**
 * Add services discovered from container labels ({ group, name, def }) to a loaded config.
 * They join the services.yaml group of the same name (or a new group at the end);
 * a service already defined in services.yaml under the same group and name wins.
 * @param {Config} cfg
 * @param {Discovered[]} discovered
 * @returns {Config}
 */
export function withDiscovered(cfg, discovered) {
  if (!discovered?.length) return cfg;
  const groups = cfg.groups.map((g) => ({ ...g, services: [...g.services] }));
  const services = [...cfg.services];
  const ids = new Set(services.map((s) => s.id));
  for (const d of discovered) {
    // label values are never secret-substituted, so no heartbeat (token) from labels
    const svc = { ...toService(d.group, d.name, d.def, cfg.settings), heartbeat: null, container: d.container ?? null, image: d.image ?? null };
    if (ids.has(svc.id)) continue;
    ids.add(svc.id);
    let group = groups.find((g) => g.name === d.group);
    if (!group) groups.push((group = { name: d.group, services: /** @type {Service[]} */ ([]) }));
    group.services.push(svc);
    services.push(svc);
  }
  return { ...cfg, groups, services };
}

/** @returns {Config} */
export function loadConfig() {
  /** @type {ConfigProblem[]} */
  const problems = [];
  missing = new Map();
  const settings = deepMerge(DEFAULT_SETTINGS, readYaml('settings.yaml', 'map', {}, problems));
  const groups = [];
  const services = [];
  const heartbeatIds = new Set();
  for (const [gname, items] of groupsOf(readYaml('services.yaml', 'list', [], problems), 'services.yaml', problems)) {
    const group = { name: gname, services: /** @type {Service[]} */ ([]) };
    for (const [name, def] of items) {
      const svc = toService(gname, name, def, settings);
      if (svc.widget?.type === 'docker' && !dockerUrlOk(svc.widget.url)) {
        problems.push({ file: 'services.yaml', message: `"${name}": a docker widget needs an http(s):// url (a socket proxy, see docs/integrations.md#docker)`, fallback: null });
      }
      const hb = heartbeatProblem(svc, def, heartbeatIds);
      if (hb) { problems.push({ file: 'services.yaml', message: hb, fallback: null }); svc.heartbeat = null; }
      group.services.push(svc);
      services.push(svc);
    }
    groups.push(group);
  }

  const bookmarks = [];
  for (const [gname, items] of groupsOf(readYaml('bookmarks.yaml', 'list', [], problems), 'bookmarks.yaml', problems)) {
    for (const [name, defs] of items) {
      const d = Array.isArray(defs) ? defs[0] : defs;
      if (d?.href) bookmarks.push({ group: gname, name, href: d.href, icon: d.icon ?? null, iconDark: d.iconDark ?? null });
    }
  }
  // by name only, never a value; the demo sets no secrets, its fixtures need none
  if (!DEMO) {
    for (const [file, keys] of missing) for (const key of keys) problems.push({ file, message: `secret ${key} is not set`, fallback: null });
  }
  return { settings, groups, services, bookmarks, problems };
}

// ---------- icons ----------
// Pinned to the branch: without a version jsDelivr may serve an old release or a copy cached for days.
export const CDN_DASHBOARD = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main';
export const CDN_SELFHST = 'https://cdn.jsdelivr.net/gh/selfhst/icons@main';

function localIcon(name) {
  const dir = path.join(CONFIG_DIR, 'icons');
  const candidates = /\.(png|svg|webp|jpg|jpeg|gif|ico)$/i.test(name) ? [name] : ['png', 'svg', 'webp'].map((e) => `${name}.${e}`);
  for (const c of candidates) {
    if (fs.existsSync(path.join(dir, c))) return '/assets/icons/' + encodeURIComponent(c);
  }
  return null;
}

/** Resolve a homepage-style icon value to a URL. Falls back to a generated monogram. */
export function resolveIcon(icon, name) {
  const mono = '/assets/monogram/' + encodeURIComponent(name || '?') + '.svg';
  if (!icon) return mono;
  if (/^https?:\/\//.test(icon)) return icon;
  if (icon.startsWith('/icons/') || icon.startsWith('/images/')) return '/assets' + icon;
  const local = localIcon(icon);
  if (local) return local;
  if (icon.startsWith('sh-')) {
    const n = icon.slice(3).replace(/\.(png|svg|webp)$/i, '');
    const ext = (icon.match(/\.(png|svg|webp)$/i) || [, 'png'])[1];
    return `${CDN_SELFHST}/${ext}/${n}.${ext}`;
  }
  if (icon.startsWith('mdi-') || icon.startsWith('si-')) return mono;
  const ext = (icon.match(/\.(png|svg|webp)$/i) || [, 'png'])[1].toLowerCase();
  const n = icon.replace(/\.(png|svg|webp)$/i, '');
  return `${CDN_DASHBOARD}/${ext}/${n}.${ext}`;
}

/** Resolve a path inside CONFIG_DIR (e.g. "images/logo.png") to a public URL. */
export function assetUrl(rel) {
  if (!rel) return null;
  if (/^https?:\/\//.test(rel)) return rel;
  return '/assets/' + rel.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}
