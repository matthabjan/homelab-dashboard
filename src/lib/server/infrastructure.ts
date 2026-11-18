// The infrastructure card's rows and the Infrastructure sheet's tabs: each panel's figure, context and level, said once
// for both. Built from the snapshot's own parts, after attention closed; the Storage and Backups rows come from
// storage.ts and backups.ts.
import { fmtClock, plural, worst } from './format.ts';
import type { InfraPanel, Snapshot } from '#lib/types';

type Parts = Pick<Snapshot, 'host' | 'drives' | 'network'>;

/** Mbit/s: whole numbers from 100 up */
const rate = (v: number | null) => (v == null ? '—' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));

/** the recorded readings of a series, the band's when it has one */
const nums = (vs: (number | null)[] | null | undefined) => (vs ?? []).filter((v): v is number => v != null);

function system(host: NonNullable<Parts['host']>): InfraPanel {
  const g = (k: string) => host.gauges.find((x) => x.key === k);
  const cpu = g('cpu'), mem = g('mem'), temp = g('temp');
  // the cell's picture is the CPU's day: its peak in the corner, its range under the figure on phones
  const hi = nums(cpu?.hi ?? cpu?.series), lo = nums(cpu?.lo ?? cpu?.series);
  const day = hi.length > 1 ? { peak: `peak ${Math.round(Math.max(...hi))}%`, range: `CPU ${Math.round(Math.min(...lo))}–${Math.round(Math.max(...hi))}% in 24 h` } : {};
  return {
    ...day,
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

function network(n: NonNullable<Parts['network']>, now: number): InfraPanel {
  const blocked = n.dns ? `${n.dns.blockedPct?.toFixed(1) ?? '—'}%` : null;
  // the picture is the download (WAN, else LAN): its 24 h peak, and on phones when it was
  const t = n.seriesDown ? n : n.lan;
  const vs = t?.downHi ?? t?.seriesDown ?? [];
  let peak: Partial<InfraPanel> = {};
  if (t?.from != null && nums(vs).length > 1) {
    const top = Math.max(...nums(vs)), i = vs.indexOf(top);
    const at = t.from + ((i + 0.5) / vs.length) * (now - t.from);
    peak = { peak: `peak ${rate(top)}`, range: `peak ${rate(top)} Mbit/s at ${fmtClock(at)}` };
  }
  return {
    ...peak,
    id: 'network', label: 'Network',
    value: n.down != null ? `↓${rate(n.down)} ↑${rate(n.up)}` : blocked ?? '—', unit: n.down != null ? 'Mbit/s' : 'blocked',
    sub: [n.source, blocked && n.down != null && `DNS ${blocked} blocked`].filter(Boolean).join(' · '),
    level: 'none'
  };
}

/** One panel per area that has data, in the card's order. */
export function infrastructure(p: Parts, from: { storage: InfraPanel | null; backups: InfraPanel | null }, now: number): InfraPanel[] {
  const out: InfraPanel[] = [];
  if (p.host) out.push(system(p.host));
  if (from.storage) out.push(from.storage);
  if (p.drives.length) out.push(drives(p.drives));
  if (p.network) out.push(network(p.network, now));
  if (from.backups) out.push(from.backups);
  return out;
}
