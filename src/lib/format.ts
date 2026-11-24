// Words and figures the pages and the server spell the same way. No DOM and no server imports: both sides use it.
import { ago } from './ago.ts';
import type { CheckKind } from '#lib/types';

/** a level that needs a look */
export const isProblem = (level: string | null | undefined): level is 'crit' | 'warn' => level === 'crit' || level === 'warn';

/** "2 h ago", "just now", "never" */
export function since(ts: number | null, now: number): string {
  if (ts == null) return 'never';
  const a = ago(ts, now);
  return a === 'now' ? 'just now' : `${a} ago`;
}

/** an uptime: "99.87%", "100%" from 99.995 up, "—" when unknown */
export const pctTxt = (v: number | null, d = 2) => (v == null ? '—' : v >= 99.995 ? '100%' : v.toFixed(d) + '%');

/** Mbit/s: whole numbers from 100 up */
export const fmtRate = (v: number | null) => (v == null ? '—' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));

/** MB/s: whole numbers from 10 up */
export const fmtMBs = (v: number | null) => (v == null ? '—' : v >= 10 ? String(Math.round(v)) : v.toFixed(1));

/** a count in short: "48k", "1.2k", "3.4M" */
export const fmtCount = (n: number | null) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));

/** how a service is checked, in words */
export const KIND: Record<CheckKind, string> = { http: 'HTTP', tcp: 'TCP', container: 'Container state', heartbeat: 'Heartbeat' };
