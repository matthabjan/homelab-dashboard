// Physical drives and their SMART data, as PVE, OMV and PBS report them, reduced to one Drive shape.
// Not an integration itself: the proxmox, openmediavault and proxmoxbackupserver integrations use it.
import type { Context, Drive, SmartReading } from '$lib/types';

const SLOW_MS = 10 * 60_000; // SMART changes slowly, and reading it wakes the disks

/** One SMART attribute: an ATA table row (PVE, PBS, smartctl text) or a named NVMe value (PBS). */
export interface SmartAttribute {
  id?: string | number;
  name?: string;
  raw?: string | number;
  value?: string | number;
  normalized?: number;
  worst?: number;
  threshold?: number;
  /** "-" when the attribute never fell below its threshold */
  fail?: string;
  flags?: string;
}

/** Leading integer of a SMART value, ignoring thousands separators in any locale ("29.306", "7,611", "34 (Min/Max 21/47)"). */
const int = (v: unknown): number | null => {
  const m = String(v ?? '').match(/^\s*([\d.,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Virtual disks of a VM (QEMU, virtio) have no SMART worth showing; the host reports the real drive. */
export const isVirtual = ({ model, vendor, serial }: { model?: string | null; vendor?: string | null; serial?: string | null }): boolean =>
  /QEMU|VBOX|VMware|Virtual/i.test(model ?? '') || ['QEMU', '0x1af4'].includes(vendor ?? '') || !serial || /^drive-/.test(serial);

/**
 * NVMe health log as smartctl prints it (PVE's text type, OMV's extended information).
 */
export function fromNvmeText(text: string): SmartReading {
  const field = (label: string) => text.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'))?.[1].trim() ?? null;
  const used = int(field('Percentage Used'));
  const units = int(field('Data Units Written'));
  return {
    tempC: int(field('Temperature')),
    hours: int(field('Power On Hours')),
    written: units == null ? null : units * 512_000, // an NVMe data unit is 1000 × 512 bytes
    lifeLeft: used == null ? null : Math.max(0, 100 - used),
    errors: int(field('Media and Data Integrity Errors')),
    failing: (field('Critical Warning') ?? '0x00') !== '0x00'
  };
}

// ATA attribute ids; vendors differ, so the first one present wins
const ATA = { temp: [194, 190], hours: [9], lbas: [241, 246], life: [202, 231, 233, 177], errors: [5, 187, 197, 198] };

/**
 * An ATA attribute table (PVE, PBS, or parsed from smartctl text). PBS reports NVMe drives as named
 * attributes instead (percentage_used, data_units_written, …), which are matched by name.
 */
export function fromAttributes(attrs: SmartAttribute[]): SmartReading {
  const byId = new Map<number, SmartAttribute>(), byName = new Map<string, SmartAttribute>();
  for (const a of attrs) {
    const id = Number(String(a.id ?? '').trim());
    if (id) byId.set(id, a);
    if (a.name) byName.set(String(a.name).toLowerCase().replace(/[^a-z0-9]+/g, '_'), a);
  }
  const pick = (ids: number[], names: string[] = []) => ids.map((i) => byId.get(i)).find(Boolean) ?? names.map((n) => byName.get(n)).find(Boolean);
  const raw = (a: SmartAttribute | undefined) => (a ? int(a.raw ?? a.value) : null);
  const used = raw(byName.get('percentage_used'));
  const units = raw(byName.get('data_units_written'));
  const lbas = raw(pick(ATA.lbas));
  const life = pick(ATA.life);
  const errs = [...ATA.errors.map((i) => byId.get(i)), byName.get('media_errors'), byName.get('media_and_data_integrity_errors')].filter((a) => a !== undefined);
  return {
    tempC: raw(pick(ATA.temp, ['temperature', 'temperature_celsius'])),
    hours: raw(pick(ATA.hours, ['power_on_hours'])),
    written: lbas != null ? lbas * 512 : units != null ? units * 512_000 : null,
    lifeLeft: life?.normalized != null ? Number(life.normalized) : used != null ? Math.max(0, 100 - used) : null,
    errors: errs.length ? errs.reduce((n, a) => n + (raw(a) ?? 0), 0) : null,
    failing: attrs.some((a) => a.fail && a.fail !== '-') || (raw(byName.get('critical_warning')) ?? 0) > 0
  };
}

/** The attribute table of `smartctl -x` text for ATA drives (OMV's extended information). */
export function attributesFromText(text: string): SmartAttribute[] {
  const rows = text.matchAll(/^\s*(\d{1,3})\s+(\S+)\s+[-A-Z]{6}\s+(\d{1,3})\s+\d{1,3}\s+\d{1,3}\s+(\S+)\s+(.+?)\s*$/gm);
  return [...rows].map(([, id, name, normalized, fail, raw]) => ({ id, name, normalized: Number(normalized), fail, raw }));
}

/** NVMe, SATA SSD, HDD or USB, from what the source calls the disk. PVE reports SATA SSDs as "hdd" with rpm 0. */
export function kindOf(type: unknown, rpm: unknown): Drive['kind'] {
  const t = String(type ?? '').toLowerCase();
  if (t === 'nvme') return 'NVMe';
  if (t === 'usb') return 'USB';
  if (t === 'ssd' || (rpm != null && rpm !== '' && Number(rpm) === 0)) return 'SSD';
  return 'HDD';
}

export function toDrive({ model, serial, kind, size, status, wearout, smart, where }: { model: string; serial: string | null; kind: Drive['kind']; size: number; status?: string | null; wearout?: unknown; smart: SmartReading | null; where?: string }): Drive {
  const wear = Number(wearout);
  return {
    model,
    serial,
    kind,
    size,
    where,
    health: smart?.failing || /fail|bad/i.test(status ?? '') ? 'failing' : /pass|ok|good/i.test(status ?? '') ? 'ok' : 'unknown',
    lifeLeft: wearout != null && Number.isFinite(wear) ? wear : smart?.lifeLeft ?? null,
    tempC: smart?.tempC ?? null,
    hours: smart?.hours ?? null,
    written: smart?.written ?? null,
    errors: smart?.errors ?? null
  };
}

/**
 * `load()` at most every 10 minutes per key, kept in ctx.state; on failure the last value stays.
 */
export async function slowly<T>(ctx: Context, key: string, load: () => Promise<T>): Promise<T | null> {
  // each key holds what its own load returned
  const cache = (ctx.state.slow ??= {}) as Record<string, { ts: number; value: T | null } | undefined>;
  const hit = cache[key];
  if (hit && ctx.now - hit.ts < SLOW_MS) return hit.value;
  let value: T | null = hit?.value ?? null;
  try { value = await load(); } catch { /* keep the last reading */ }
  cache[key] = { ts: ctx.now, value };
  return value;
}
