// What the read-only /config page shows. Built from an allowlist, never by removing secrets: every value here was
// picked on purpose (type, URL origin, a few per-type options, status), so a new secret-looking key can't leak.
// Not shown: usernames, passwords, keys, tokens, headers, request bodies, URL userinfo / paths / queries, heartbeat
// tokens, and label values beyond group and name.
import { DEFAULT_SETTINGS, DEMO } from './config.ts';
import { INTEGRATIONS } from './integrations/index.ts';
import { fmtDuration } from './format.ts';
import { kindOf } from './check.ts';
import type { ConfigView, KeyValue, Level, Service, Tile } from '$lib/types';
import type { Engine } from './engine.ts';

/** What the config view reads from the engine; the Engine itself satisfies it. */
export type ConfigViewInput = Pick<Engine, 'cfg' | 'state' | 'discoveredBy' | 'autoIcons' | 'snapshot'>;

const DOCS = 'https://github.com/matthabjan/homelab-dashboard/blob/main/docs/integrations.md';
/** Section of docs/integrations.md per widget type. */
const ANCHORS: Record<string, string> = {
  proxmox: 'proxmox-ve', proxmoxbackupserver: 'proxmox-backup-server', opnsense: 'opnsense', openmediavault: 'openmediavault',
  adguard: 'adguard-home', pihole: 'pi-hole', portainer: 'portainer', docker: 'docker', fritzbox: 'fritzbox', customapi: 'custom-api'
};
/** Widget options that are safe to show, per type. Everything else stays on the server. */
const SAFE_OPTIONS: Record<string, string[]> = {
  proxmox: ['node'],
  proxmoxbackupserver: ['datastore'],
  opnsense: ['wan'],
  portainer: ['env'],
  pihole: ['version'],
  customapi: ['method', 'refreshInterval']
};

/** Scheme, host and port: no userinfo, path or query, which can carry tokens. Just the scheme for a non-URL. */
export function originOf(url: unknown): string | null {
  try {
    const u = new URL(String(url));
    return /^(https?|tcp):$/.test(u.protocol) ? `${u.protocol}//${u.host}` : u.protocol;
  } catch {
    return null;
  }
}

/** The config name for an automatic icon's URL: `sh-<name>.<ext>` for selfh.st, `<name>.<ext>` for dashboard-icons. */
export function iconName(url: string): string {
  const m = String(url ?? '').match(/\/gh\/(selfhst|homarr-labs)\/[^/]+\/\w+\/([^/]+)$/);
  if (!m) return url;
  return m[1] === 'selfhst' ? `sh-${m[2]}` : m[2];
}

/** A setting's value as text. */
const text = (v: unknown): string => (v == null ? '—' : Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Every setting the defaults define (none of them is a secret), with its effective value, as `a.b` keys.
 */
export function settingsList(settings: object | null | undefined, defaults: object = DEFAULT_SETTINGS, prefix = ''): KeyValue[] {
  const cur = (settings ?? {}) as Record<string, unknown>;
  return Object.entries(defaults).flatMap(([k, d]) => (d && typeof d === 'object' && !Array.isArray(d)
    ? settingsList(cur[k] as object | undefined, d, `${prefix}${k}.`)
    : [{ k: prefix + k, v: text(cur[k] === undefined ? d : cur[k]) }]));
}

/**
 * One row per widget: type, docs, URL origin, the safe options, and how its last poll went.
 */
function widgetRows(engine: ConfigViewInput): ConfigView['widgets'] {
  const { services } = engine.cfg;
  // which widget discovered each label service, for its source
  const finder = new Map([...engine.discoveredBy].flatMap(([sid, list]) => list.map((d) => [`${d.group}\0${d.name}`, sid])));
  const sourceOf = (s: Service) => {
    if (!s.container) return 'services.yaml';
    const by = services.find((x) => x.id === finder.get(`${s.group}\0${s.name}`));
    return by ? `labels via ${by.name}` : 'container labels';
  };
  return services.filter((s) => s.widget?.type).map((s) => {
    const w = (s.widget as NonNullable<Service['widget']>);
    const st = engine.state(s.id).widget;
    const options = (SAFE_OPTIONS[w.type] ?? []).filter((k) => w[k] != null && typeof w[k] !== 'object').map((k) => ({ k, v: String(w[k]) }));
    if (w.type === 'customapi' && Array.isArray(w.mappings)) options.push({ k: 'mappings', v: String(w.mappings.length) });
    const status: ConfigView['widgets'][number]['status'] = !(w.type in INTEGRATIONS) ? 'unsupported' : !st ? 'never' : st.ok ? 'ok' : 'error';
    return {
      id: s.id,
      name: s.name,
      group: s.group,
      type: String(w.type),
      docs: ANCHORS[w.type] ? `${DOCS}#${ANCHORS[w.type]}` : null,
      origin: originOf(w.url),
      options,
      status,
      // the same short message the tile shows every viewer; upstream bodies only reach the log
      error: st && !st.ok ? st.error ?? 'failed' : null,
      lastOk: st?.lastOk ?? null,
      source: sourceOf(s)
    };
  });
}

/**
 * One row per service with a check: its kind, target (origin only), interval and current state from the snapshot.
 */
function checkRows(engine: ConfigViewInput): ConfigView['checks'] {
  const iv = engine.cfg.settings.intervals;
  const tiles: Map<string, Tile> = new Map((engine.snapshot?.groups ?? []).flatMap((g) => g.services.map((t) => [t.id, t])));
  return engine.cfg.services.flatMap((s) => {
    const kind = kindOf(s);
    if (!kind) return [];
    const t = tiles.get(s.id);
    const hb = s.heartbeat;
    return [{
      id: s.id,
      name: s.name,
      group: s.group,
      kind,
      target: hb ? `/api/heartbeat/${hb.id}` : kind === 'container' ? 'container state' : originOf(s.probe) ?? '—',
      interval: hb ? `every ${fmtDuration(hb.every)} + ${fmtDuration(hb.grace)} grace` : `every ${fmtDuration((kind === 'container' ? iv.widgets : iv.probe) * 1000)}`,
      state: t?.status ?? 'Checking',
      level: t?.level ?? 'unknown'
    }];
  });
}

/** Automatic icons as the YAML that makes them permanent. */
function iconRows(engine: ConfigViewInput): ConfigView['icons'] {
  return engine.cfg.services.flatMap((s) => {
    const auto = s.icon ? null : engine.autoIcons.get(s.id);
    if (!auto) return [];
    const icon = iconName(auto.icon);
    const iconDark = auto.iconDark ? iconName(auto.iconDark) : null;
    return [{ id: s.id, name: s.name, group: s.group, icon, iconDark, yaml: `icon: ${icon}${iconDark ? `\niconDark: ${iconDark}` : ''}` }];
  });
}

export function buildConfigView(engine: ConfigViewInput): ConfigView {
  const { settings, problems } = engine.cfg;
  return {
    title: settings.title,
    demo: DEMO,
    generatedAt: Date.now(),
    problems: (problems ?? []).map((p) => ({ file: p.file, message: p.message, level: (p.fallback === 'none' ? 'crit' : 'warn' as Level) })),
    widgets: widgetRows(engine),
    checks: checkRows(engine),
    icons: iconRows(engine),
    settings: settingsList(settings)
  };
}
