// How long ago a time was, short enough for the feed's time column: "now", "5 m", "2 h 05 m", "11 h", "3 d".

export function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h${h < 10 && m % 60 ? ' ' + String(m % 60).padStart(2, '0') + ' m' : ''}`;
  return `${Math.floor(h / 24)} d`;
}
