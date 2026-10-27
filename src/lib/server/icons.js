// Automatic icons for services without `icon`: the service name, then the container image, is looked up in the
// selfh.st and dashboard-icons indexes (refreshed daily, kept in kv). The coloured icon is used in both themes;
// when it is nearly black, a light variant of it becomes the dark-theme icon.
// Variant names can't be trusted for that: in dashboard-icons `lldap-dark` is the light one, `proxmox-light` too.
import { request } from './http.js';
import { slug } from './config.js';
/** @import { Kv, Transport } from '$lib/types' */

const SH = 'https://cdn.jsdelivr.net/gh/selfhst/icons';
const DI = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons';
const DAY = 86_400_000;
const RETRY = 3600_000;

/**
 * Names to look up, best first: the service name, then the image (`ghcr.io/immich-app/immich-server:v2` →
 * `immich-server`, `immich`). The image owner is skipped: `linuxserver` would match linuxserver's logo.
 * @param {string} name @param {string | null} [image]
 */
export function iconCandidates(name, image) {
  const out = [slug(name.replace(/['’]/g, ''))];
  const repo = image && !image.startsWith('sha256:') ? image.split('@')[0].split('/').at(-1)?.split(':')[0] : null;
  if (repo) out.push(slug(repo), slug(repo).replace(/-(server|app|web|ce|ee|oss)$/, ''));
  return [...new Set(out.filter(Boolean))];
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

const DARK = 0.2;

/**
 * @param {{ kv: Kv, transport?: Transport, now?: () => number }} opts
 */
export function createIconFinder({ kv, transport = request, now = Date.now }) {
  /** @type {{ ts: number, sh: Record<string, [string, number]>, di: Record<string, string[]> } | null} */
  let index = kv.get('icons.index');
  let tried = 0;
  /** @type {Map<string, Promise<boolean | null>>} url → is it nearly black (null: unknown) */
  const dark = new Map();
  /** @type {Map<string, Promise<{ icon: string, iconDark: string | null } | null>>} */
  const found = new Map();

  const get = async (url) => {
    const res = await transport(url, { insecure: false, timeout: 15_000 });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };

  // A failed check counts as "not dark" for now and forgets the lookups that used it, so the next run retries.
  const isDark = (url) => {
    if (!dark.has(url)) dark.set(url, get(url).then((r) => r.text()).then((svg) => svgLuminance(svg) < DARK, () => {
      dark.delete(url);
      found.clear();
      return null;
    }));
    return /** @type {Promise<boolean | null>} */ (dark.get(url));
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
      dark.clear();
    } catch (e) {
      console.warn(`[icons] index not updated: ${e.message}`);
    }
  }

  async function lookup(name) {
    const sh = index?.sh[name];
    if (sh) {
      const [ext, light] = sh;
      const icon = `${SH}/${ext}/${name}.${ext}`;
      return { icon, iconDark: light && ext === 'svg' && (await isDark(icon)) ? `${SH}/svg/${name}-light.svg` : null };
    }
    const di = index?.di[name];
    if (!di) return null;
    const [ext, ...variants] = di;
    const icon = `${DI}/${ext}/${name}.${ext}`;
    if (ext !== 'svg' || !variants.length || !(await isDark(icon))) return { icon, iconDark: null };
    for (const v of variants) if ((await isDark(`${DI}/svg/${v}.svg`)) === false) return { icon, iconDark: `${DI}/svg/${v}.svg` };
    return { icon, iconDark: null };
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
