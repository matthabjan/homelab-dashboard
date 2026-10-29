// Automatic icons for services without `icon`: the service name, the container image, the widget type, then the
// name's leading words are looked up in the selfh.st and dashboard-icons indexes (refreshed daily, kept in kv). The
// icon itself is used in both themes; only when it would vanish in one, a variant takes its place there: the light one
// in dark mode for a nearly black icon, the dark one in light mode for a nearly white icon. Variants are judged by
// their colours, not their names: in dashboard-icons `lldap-dark` is the light one, `proxmox-light` too.
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

/** Darkest and brightest colour an SVG paints with, 0–1 (relative luminance). Unpainted shapes are black. */
export function svgLuminance(svg) {
  const lum = (/** @type {number[]} */ rgb) => {
    const [r, g, b] = rgb.map((c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  let [min, max] = [1, 0];
  for (const [, v] of svg.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}\b|white|black|rgb\([^)]*\))/gi)) {
    const c = v.toLowerCase();
    const hex = c.startsWith('#') ? (c.length < 6 ? [...c.slice(1, 4)].map((h) => h + h) : [c.slice(1, 3), c.slice(3, 5), c.slice(5, 7)]).map((h) => parseInt(h, 16)) : null;
    const rgb = c === 'white' ? [255, 255, 255] : c === 'black' ? [0, 0, 0] : hex ?? (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    if (rgb.length === 3) [min, max] = [Math.min(min, lum(rgb)), Math.max(max, lum(rgb))];
  }
  return { min: Math.min(min, max), max };
}

// The icon chip (--surface-2) in each theme, as relative luminance: #eef0f3 and #191e26.
const BG_LIGHT = 0.86;
const BG_DARK = 0.012;
/** Below this contrast ratio against its chip, an icon counts as invisible in that theme. */
const MIN_CONTRAST = 1.5;
const contrast = (/** @type {number} */ a, /** @type {number} */ b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * @param {{ kv: Kv, transport?: Transport, now?: () => number }} opts
 */
export function createIconFinder({ kv, transport = request, now = Date.now }) {
  /** @type {{ ts: number, sh: Record<string, [string, number, number]>, di: Record<string, string[]> } | null} */
  let index = kv.get('icons.index');
  if (index && Object.values(index.sh).some((e) => e.length < 3)) index = null; // stored before dark variants were kept
  let tried = 0;
  /** @type {Map<string, Promise<{ min: number, max: number } | null>>} url → darkest and brightest colour (null: unknown) */
  const bright = new Map();
  /** @type {Map<string, Promise<{ icon: string, iconDark: string | null } | null>>} */
  const found = new Map();

  // errors name the URL and the cause: undici's own message is just "fetch failed"
  const get = async (url) => {
    const res = await transport(url, { insecure: false, timeout: 15_000 }).catch((e) => {
      throw new Error(`${url}: ${e.cause?.code ?? e.message}`);
    });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };

  // A failed check means "no light variant" for now and forgets the lookups that used it, so the next run retries.
  const luminance = (url) => {
    if (!bright.has(url)) bright.set(url, get(url).then((r) => r.text()).then(svgLuminance, (e) => {
      console.warn(`[icons] colour check failed: ${e.message}`);
      bright.delete(url);
      found.clear();
      return null;
    }));
    return /** @type {Promise<{ min: number, max: number } | null>} */ (bright.get(url));
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
        sh: Object.fromEntries(sh.map((e) => [e.Reference, [e.SVG === 'Yes' ? 'svg' : 'png', e.Light === 'Yes' ? 1 : 0, e.Dark === 'Yes' ? 1 : 0]])),
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

  /**
   * The icon in both themes, unless it would vanish in one: its brightest colour barely shows on the dark chip
   * (LLDAP) → the light variant for dark mode; its darkest barely shows on the light chip → the dark variant for
   * light mode. selfh.st names its variants reliably (`named`); dashboard-icons' are measured and the best one taken.
   * @param {string} icon @param {string[]} variants @param {{ light: string | null, dark: string | null }} [named]
   */
  async function pick(icon, variants, named) {
    const base = await luminance(icon);
    if (!base || !(variants.length || named?.light || named?.dark)) return { icon, iconDark: null };
    const dark = contrast(base.max, BG_DARK) < MIN_CONTRAST;
    if (!dark && contrast(base.min, BG_LIGHT) >= MIN_CONTRAST) return { icon, iconDark: null };
    if (named) {
      const v = dark ? named.light : named.dark;
      return !v ? { icon, iconDark: null } : dark ? { icon, iconDark: v } : { icon: v, iconDark: icon };
    }
    const score = (/** @type {{ min: number, max: number }} */ l) => (dark ? contrast(l.max, BG_DARK) : contrast(l.min, BG_LIGHT));
    let best = null;
    let bestScore = score(base);
    for (const v of variants) {
      const l = await luminance(v);
      if (l && score(l) > bestScore) [best, bestScore] = [v, score(l)];
    }
    if (!best || bestScore < MIN_CONTRAST) return { icon, iconDark: null };
    return dark ? { icon, iconDark: best } : { icon: best, iconDark: icon };
  }

  async function lookup(name) {
    name = resolve(name);
    const sh = index?.sh[name];
    if (sh) {
      const [ext, light, dark] = sh;
      const icon = `${SH}/${ext}/${name}.${ext}`;
      if (ext !== 'svg') return { icon, iconDark: null };
      return pick(icon, [], { light: light ? `${SH}/svg/${name}-light.svg` : null, dark: dark ? `${SH}/svg/${name}-dark.svg` : null });
    }
    const di = index?.di[name];
    if (!di) return null;
    const [ext, ...variants] = di;
    const icon = `${DI}/${ext}/${name}.${ext}`;
    if (ext !== 'svg') return { icon, iconDark: null };
    return pick(icon, variants.map((v) => `${DI}/svg/${v}.svg`));
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
