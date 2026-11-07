// The infrastructure card's rows and the Infrastructure sheet's tabs: each panel's figure, context and level, said once
// for both. Built from the snapshot's own parts, after attention closed; the Backups row comes from backups.ts.
import { plural, worst } from './format.ts';
import type { InfraPanel, Snapshot } from '$lib/types';

type Parts = Pick<Snapshot, 'host' | 'storage' | 'drives' | 'network'>;

/** a storage row's name for prose: "media · NAS" → "media (NAS)" */
const storageName = (name: string) => name.replace(/^(.+?) · (.+)$/, '$1 ($2)');
/** Mbit/s: whole numbers from 100 up */
const rate = (v: number | null) => (v == null ? '—' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));

function system(host: NonNullable<Parts['host']>): InfraPanel {
  const g = (k: string) => host.gauges.find((x) => x.key === k);
  const cpu = g('cpu'), mem = g('mem'), temp = g('temp');
  return {
    id: 'system', label: 'System', where: host.name, value: '',
    sub: host.facts.map((f) => `${f.label} ${f.value}`).join(' · '),
    stats: [
      cpu && { k: 'CPU', v: `${cpu.val}%`, level: cpu.level },
      mem && { k: 'RAM', v: mem.pct != null ? `${Math.round(mem.pct)}%` : '—', level: mem.level },
      temp && { k: 'TEMP', v: `${temp.val}°C`, level: temp.level }
    ].filter((x) => !!x),
    level: worst(host.gauges.map((x) => x.level))
  };
}

/**
 * A detached or unavailable row (a removable offsite disk) is expected: it never sets the figure or the level. The
 * panel turns amber only for a row over storageWarnPct, which raises an alert; a bar's amber stays in the sheet.
 */
function storage(rows: Parts['storage']): InfraPanel {
  const used = rows.filter((s) => s.level !== 'off' && s.pct != null);
  const top = [...used].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
  const off = rows.length - used.length;
  return {
    id: 'storage', label: 'Storage', value: top ? `${Math.round(top.pct ?? 0)}%` : '—', unit: top ? 'full' : '',
    sub: [top ? `fullest: ${storageName(top.name)}` : 'no usage reported', off && `${off} offline`].filter(Boolean).join(' · '),
    level: used.some((s) => s.level === 'crit') ? 'warn' : 'none',
    meta: plural(rows.length, 'storage') + (off ? ` · ${off} offline` : '')
  };
}

function drives(d: Parts['drives']): InfraPanel {
  const failing = d.filter((x) => x.status === 'failing').length;
  const check = d.filter((x) => x.status === 'check').length;
  const temps = d.flatMap((x) => (x.tempC != null ? [x.tempC] : []));
  const lives = d.flatMap((x) => (x.life != null ? [x.life] : []));
  const allOk = d.every((x) => x.status === 'ok');
  return {
    id: 'drives', label: 'Drives',
    value: failing ? `${failing} failing` : check ? `${check} to check` : allOk ? 'All healthy' : 'No problems',
    sub: [plural(d.length, 'drive'), temps.length && `max ${Math.max(...temps)}°C`, lives.length && `${Math.min(...lives)}% life left`].filter(Boolean).join(' · '),
    level: worst(d.map((x) => x.level)),
    meta: plural(d.length, 'drive') + (failing ? ` · ${failing} failing` : check ? ` · ${check} to check` : allOk ? ' · SMART ok' : '')
  };
}

function network(n: NonNullable<Parts['network']>): InfraPanel {
  const blocked = n.dns ? `${n.dns.blockedPct?.toFixed(1) ?? '—'}%` : null;
  return {
    id: 'network', label: 'Network',
    value: n.down != null ? `↓${rate(n.down)} ↑${rate(n.up)}` : blocked ?? '—', unit: n.down != null ? 'Mbit/s' : 'blocked',
    sub: [n.source, blocked && n.down != null && `DNS ${blocked} blocked`].filter(Boolean).join(' · '),
    level: 'none'
  };
}

/** One panel per area that has data, in the card's order. */
export function infrastructure(p: Parts, backups: InfraPanel | null): InfraPanel[] {
  const out: InfraPanel[] = [];
  if (p.host) out.push(system(p.host));
  if (p.storage.length) out.push(storage(p.storage));
  if (p.drives.length) out.push(drives(p.drives));
  if (p.network) out.push(network(p.network));
  if (backups) out.push(backups);
  return out;
}
