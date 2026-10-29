// Automatic icons for services without `icon`: the service name, the container image, the widget type, then the
// name's leading words are looked up in the selfh.st and dashboard-icons indexes (refreshed daily, kept in kv). When
// the icon has a light variant, that becomes the dark-theme icon. selfh.st marks it in its index; for dashboard-icons
// the brightest variant is taken, as names can't be trusted: there `lldap-dark` is the light one.
import { request } from './http.js';
import { CDN_DASHBOARD as DI, CDN_SELFHST as SH, slug } from './config.js';
/** @import { Kv, Transport } from '$lib/types' */

const DAY = 86_400_000;
const RETRY = 3600_000;

/** Widget types whose icon has another name. */
const TYPE_ICONS = { proxmoxbackupserver: 'proxmox-backup-server', adguard: 'adguard-home', pihole: 'pi-hole', customapi: null };

/**
 * Names to look up, best first: the service name, then the image (`ghcr.io/immich-app/immich-server:v2` →
 * `immich-server`, `immich`), the widget type, and last the name's leading words (`Proxmox VE` → `proxmox`).
 * The image owner is skipped: `linuxserver` would match linuxserver's logo.
 * @param {string} name @param {string | null} [image] @param {string | null} [type]
 */
export function iconCandidates(name, image, type) {
  const words = name.replace(/['’]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean);
  const out = [slug(name.replace(/['’]/g, '')), slug(words.join(' '))];
  const repo = image && !image.startsWith('sha256:') ? image.split('@')[0].split('/').at(-1)?.split(':')[0] : null;
  if (repo) out.push(slug(repo), slug(repo).replace(/-(server|app|web|ce|ee|oss)$/, ''));
  if (type) out.push(type in TYPE_ICONS ? TYPE_ICONS[/** @type {keyof TYPE_ICONS} */ (type)] : type);
  for (let n = words.length - 1; n > 0; n--) out.push(slug(words.slice(0, n).join(' ')));
  return [...new Set(out.filter((c) => !!c))];
}

/** Brightest colour an SVG paints with, 0–1 (relative luminance). Unpainted shapes are black. */
export function svgLuminance(svg) {
  const lum = (/** @type {number[]} */ rgb) => {
    const [r, g, b] = rgb.map((c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  let max = 0;
  for (const [, v] of svg.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}\b|white|black|rgb\([^)]*\))/gi)) {
    const c = v.toLowerCase();
    if (c === 'white') return 1;
    if (c === 'black') continue;
    const hex = c.startsWith('#') ? (c.length < 6 ? [...c.slice(1, 4)].map((h) => h + h) : [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)]).map((h) => parseInt(h, 16)) : null;
    const rgb = hex ?? (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    if (rgb.length === 3) max = Math.max(max, lum(rgb));
  }
  return max;
}

/**
 * @param {{ kv: Kv, transport?: Transport, now?: () => number }} opts
 */
export function createIconFinder({ kv, transport = request, now = Date.now }) {
  /** @type {{ ts: number, sh: Record<string, [string, number]>, di: Record<string, string[]> } | null} */
  let index = kv.get('icons.index');
  let tried = 0;
  /** @type {Map<string, Promise<number | null>>} url → brightest colour (null: unknown) */
  const bright = new Map();
  /** @type {Map<string, Promise<{ icon: string, iconDark: string | null } | null>>} */
  const found = new Map();

  const get = async (url) => {
    const res = await transport(url, { insecure: false, timeout: 15_000 });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };

  // A failed check means "no light variant" for now and forgets the lookups that used it, so the next run retries.
  const luminance = (url) => {
    if (!bright.has(url)) bright.set(url, get(url).then((r) => r.text()).then(svgLuminance, () => {
      bright.delete(url);
      found.clear();
      return null;
    }));
    return /** @type {Promise<number | null>} */ (bright.get(url));
  };

  /** Fetch both indexes when older than a day; a failure keeps the old ones and retries after an hour. */
  async function refresh() {
    const t = now();
    if ((index && t - index.ts < DAY) || t - tried < RETRY) return;
    tried = t;
    try {
      const [sh, di] = await Promise.all([get(`${SH}/index.json`).then((r) => r.json()), get(`${DI}/metadata.json`).then((r) => r.json())]);
      index = {
        ts: t,
        sh: Object.fromEntries(sh.map((e) => [e.Reference, [e.SVG === 'Yes' ? 'svg' : 'png', e.Light === 'Yes' ? 1 : 0]])),
        di: Object.fromEntries(Object.entries(di).map(([n, m]) => [n, [m.base, ...Object.values(m.colors ?? {}).filter((v) => v !== n)]]))
      };
      kv.set('icons.index', index);
      found.clear();
      bright.clear();
    } catch (e) {
      console.warn(`[icons] index not updated: ${e.message}`);
    }
  }

  /** @type {{ for: object | null, map: Map<string, string> }} name without hyphens → name (`musicassistant`) */
  const loose = { for: null, map: new Map() };
  const compact = (/** @type {string} */ n) => n.replace(/-/g, '');

  /** Exact name, else the same name spelled with or without hyphens. */
  function resolve(name) {
    if (!index || index.sh[name] || index.di[name]) return name;
    if (loose.for !== index) {
      loose.for = index;
      loose.map = new Map();
      for (const n of [...Object.keys(index.sh), ...Object.keys(index.di)]) if (!loose.map.has(compact(n))) loose.map.set(compact(n), n);
    }
    return loose.map.get(compact(name)) ?? name;
  }

  async function lookup(name) {
    name = resolve(name);
    const sh = index?.sh[name];
    if (sh) {
      const [ext, light] = sh;
      const icon = `${SH}/${ext}/${name}.${ext}`;
      return { icon, iconDark: light ? `${SH}/${ext}/${name}-light.${ext}` : null };
    }
    const di = index?.di[name];
    if (!di) return null;
    const [ext, ...variants] = di;
    const icon = `${DI}/${ext}/${name}.${ext}`;
    if (ext !== 'svg' || !variants.length) return { icon, iconDark: null };
    let best = await luminance(icon);
    let iconDark = null;
    if (best === null) return { icon, iconDark };
    for (const v of variants) {
      const l = await luminance(`${DI}/svg/${v}.svg`);
      if (l !== null && l > best) [best, iconDark] = [l, `${DI}/svg/${v}.svg`];
    }
    return { icon, iconDark };
  }

  return {
    refresh,
    /** First candidate either collection has; selfh.st first, it has light variants for most icons. */
    find(/** @type {string[]} */ candidates) {
      const key = candidates.join(' ');
      if (!found.has(key)) found.set(key, (async () => {
        for (const c of candidates) { const r = await lookup(c); if (r) return r; }
        return null;
      })());
      return /** @type {Promise<{ icon: string, iconDark: string | null } | null>} */ (found.get(key));
    }
  };
}
