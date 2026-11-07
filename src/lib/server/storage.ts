// How full a disk is, judged once: its bar, its alert and the Storage row on the infrastructure card. Storage rows come
// from widgets (PVE, PBS, OMV), the System panel's Disk gauge from the Proxmox node or the local host; a disk shown in
// both (the same metric) warns once.
import { plural, worst } from './format.ts';
import type { Raised } from './attention.ts';
import type { HostVitals, InfraPanel, Level, Service, Settings, Snapshot, StorageRow, Trend } from '$lib/types';

type Th = Pick<Settings['thresholds'], 'storageAmberPct' | 'storageWarnPct'>;
type Owner = Pick<Service, 'id' | 'name' | 'href'>;

/** One service's storage rows. */
export interface StorageReport {
  service: Owner;
  rows: StorageRow[];
}

/** The disk on the System panel's gauge: a Proxmox node's, with its service, or the local host's (no service). */
export interface GaugeDisk {
  service?: Owner;
  node: string;
  disk: HostVitals['disk'];
}

/** A fill's level: red from storageWarnPct (which warns), amber from storageAmberPct (only the bar). */
export const usageLevel = (pct: number, th: Th): Level => (pct >= th.storageWarnPct ? 'crit' : pct >= th.storageAmberPct ? 'warn' : 'ok');

/** a storage row's name for prose: "media · NAS" → "media (NAS)" */
const storageName = (name: string) => name.replace(/^(.+?) · (.+)$/, '$1 ($2)');

/**
 * The card's row. A detached or unavailable row (a removable offsite disk) is expected: it never sets the figure or
 * the level. The row is as bad as what is raised for the rows, so a bar's amber stays in the sheet.
 */
function panel(rows: Snapshot['storage'], raised: Raised[]): InfraPanel {
  const used = rows.filter((s) => s.level !== 'off' && s.pct != null);
  const top = [...used].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
  const off = rows.length - used.length;
  return {
    id: 'storage', label: 'Storage', value: top ? `${Math.round(top.pct ?? 0)}%` : '—', unit: top ? 'full' : '',
    sub: [top ? `fullest: ${storageName(top.name)}` : 'no usage reported', off && `${off} offline`].filter(Boolean).join(' · '),
    level: worst(raised.map((a) => a.sev)),
    meta: plural(rows.length, 'storage') + (off ? ` · ${off} offline` : '')
  };
}

/** The gauge's disk warns itself when no storage row of its service has its metric, or for the local host. */
function gaugeAlert({ service, node, disk }: GaugeDisk, reports: StorageReport[], th: Th): Raised | null {
  if (disk.pct == null || disk.pct < th.storageWarnPct) return null;
  const pct = Math.round(disk.pct);
  if (!service) return { sev: 'warn', source: 'host', key: 'local-disk', title: `Disk ${disk.name} is ${pct}% full`, detail: `${node} · ${disk.sub}` };
  const shown = reports.some((r) => r.service.id === service.id && r.rows.some((x) => x.metric === disk.metric));
  return shown ? null : { sev: 'warn', service, key: `storage-${disk.name}`, title: `${disk.name} is ${pct}% full`, detail: disk.sub };
}

/**
 * The Storage panel's rows (services in services.yaml order, each by name: APIs don't keep a stable order, and an
 * offline row keeps its place), what to raise, the gauge's level and the card's row (null without rows). An offline row
 * is grey and raises nothing here: its widget raises any alert itself.
 */
export function storage(reports: StorageReport[], gauge: GaugeDisk | null, th: Th, trend: (metric: string | undefined) => Trend | null) {
  const rows: Snapshot['storage'] = [];
  const raised: Raised[] = [];
  for (const { service, rows: list } of reports) {
    for (const x of [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      const base = { name: x.name, group: service.name, sub: x.sub, warn: th.storageAmberPct, trend: trend(x.metric) };
      if (x.offline || x.pct == null) { rows.push({ ...base, pct: x.pct ?? null, level: 'off' }); continue; }
      rows.push({ ...base, pct: x.pct, level: usageLevel(x.pct, th) });
      if (x.pct >= th.storageWarnPct) raised.push({ sev: 'warn', service, key: `storage-${x.name}`, title: `${x.name} is ${Math.round(x.pct)}% full`, detail: x.sub });
    }
  }
  const disk = gauge && gaugeAlert(gauge, reports, th);
  return {
    rows,
    raised: disk ? [...raised, disk] : raised,
    gaugeLevel: gauge?.disk.pct == null ? 'none' as const : usageLevel(gauge.disk.pct, th),
    panel: rows.length ? panel(rows, raised) : null
  };
}
