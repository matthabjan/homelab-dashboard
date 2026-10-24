export const GiB = 1024 ** 3;
export const TiB = 1024 ** 4;

export function fmtBytes(b, digits = 1) {
  if (b == null || !Number.isFinite(b)) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(digits)} ${units[i]}`;
}

/** "41.2 / 64 GiB" — both values in the unit of the total */
export function fmtPair(used, total) {
  /** @type {[string, number][]} */
  const units = [['TiB', TiB], ['GiB', GiB], ['MiB', 1024 ** 2]];
  const [u, f] = units.find(([, f]) => total >= f) || units[2];
  const a = used / f, t = total / f;
  const r = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
  return `${r(a)} / ${r(t)} ${u}`;
}

export function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

export function fmtDuration(ms) {
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
export const fmtClock = (ts) => (ts == null ? '—' : new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));

/** "42%", or "—" when the size is unknown */
export const fmtPct = (p) => (p == null ? '—' : `${Math.round(p)}%`);

export const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** "2 TB", "512 GB": decimal units, the way drives are sold and SMART counts bytes written */
export const fmtSize = (b) => (b == null ? '—' : b >= 1e12 ? `${Math.round(b / 1e11) / 10} TB` : `${Math.round(b / 1e9)} GB`);

/** Power-on time: "36 h", "317 d", "3.3 y" */
export const fmtHours = (h) => (h == null ? '—' : h < 48 ? `${h} h` : h < 8766 ? `${Math.round(h / 24)} d` : `${(h / 8766).toFixed(1)} y`);
