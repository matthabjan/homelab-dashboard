import type { Stat } from '$lib/types';

export const GiB = 1024 ** 3;
export const TiB = 1024 ** 4;

export function fmtBytes(b: number | null | undefined, digits = 1): string {
  if (b == null || !Number.isFinite(b)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(digits)} ${units[i]}`;
}

/** "41.2 / 64 GiB" — both values in the unit of the total */
export function fmtPair(used: number, total: number): string {
  const units: [string, number][] = [['TiB', TiB], ['GiB', GiB], ['MiB', 1024 ** 2]];
  const [u, f] = units.find(([, f]) => total >= f) || units[2];
  const a = used / f, t = total / f;
  const r = (x: number) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
  return `${r(a)} / ${r(t)} ${u}`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 && h < 10 ? ` ${String(m % 60).padStart(2, '0')} m` : ''}`;
  return `${Math.floor(h / 24)} d`;
}

/** "14:05" for a timestamp, in local time */
export const fmtClock = (ts: number | null | undefined): string => (ts == null ? '—' : new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));

/** "42%", or "—" when the size is unknown */
export const fmtPct = (p: number | null | undefined): string => (p == null ? '—' : `${Math.round(p)}%`);

export const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** "2 TB", "512 GB": decimal units, the way drives are sold and SMART counts bytes written */
export const fmtSize = (b: number | null | undefined): string => (b == null ? '—' : b >= 1e12 ? `${Math.round(b / 1e11) / 10} TB` : `${Math.round(b / 1e9)} GB`);

/** Power-on time: "36 h", "317 d", "3.3 y" */
export const fmtHours = (h: number | null | undefined): string => (h == null ? '—' : h < 48 ? `${h} h` : h < 8766 ? `${Math.round(h / 24)} d` : `${(h / 8766).toFixed(1)} y`);

/** Bits per second: "850 kbit/s", "12.5 Mbit/s", "1.2 Gbit/s" (decimal, the way line speeds are quoted) */
export function fmtBitrate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  const units = ['bit/s', 'kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s'];
  let i = 0;
  let v = bps;
  while (Math.abs(v) >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** "3 h ago", "in 2 d", "now" for a timestamp relative to `now` */
export function fmtRelative(ts: number | null | undefined, now: number): string {
  if (ts == null || !Number.isFinite(ts)) return '—';
  const d = ts - now;
  if (Math.abs(d) < 60_000) return 'now';
  return d < 0 ? `${fmtDuration(-d)} ago` : `in ${fmtDuration(d)}`;
}

/**
 * A widget's card from its facts, each a stat and the same as text: the Most used card shows the first two stats,
 * the service card the line, so the line is the first two texts and both say the same.
 */
export function card(facts: [Stat, string][], empty = 'Online'): { stats: Stat[]; line: string } {
  return { stats: facts.map(([stat]) => stat), line: facts.slice(0, 2).map(([, text]) => text).join(' · ') || empty };
}
