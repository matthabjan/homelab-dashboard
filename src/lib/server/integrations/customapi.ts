// Custom API — any JSON endpoint, with gethomepage's customapi fields (url, method, headers, requestBody,
// username/password, refreshInterval, mappings). Our addition: per-mapping `warn` / `crit` thresholds, which raise
// alerts only (the service's status stays its reachability).
import { basicAuth } from '../http.ts';
import { fmtBitrate, fmtBytes, fmtDuration, fmtRelative } from '../format.ts';
import type { Alert, Context, CustomApiMapping, Json, Stat, Threshold, Widget, WidgetResult } from '$lib/types';

type CustomApiWidget = Widget & {
  method?: string;
  headers?: Record<string, string>;
  requestBody?: Json;
  /** ms */
  refreshInterval?: number | string;
  mappings?: CustomApiMapping[] };

interface CustomApiState {
  last?: WidgetResult;
  lastRun?: number;
  /** the widget config the last result was read with: an edit to services.yaml reads again at once */
  config?: string;
}

type JsonObject = { [key: string]: Json };

/** `a.b.0.c`, or gethomepage's nested form `{ a: { b: c } }`, as a list of keys. */
export function fieldPath(field: Json | undefined) {
  const keys: string[] = [];
  let f = field;
  while (f && typeof f === 'object') {
    const k = Object.keys(f)[0];
    if (k == null) break;
    keys.push(k);
    f = (f as JsonObject)[k];
  }
  if (f != null && typeof f !== 'object') keys.push(...String(f).split('.'));
  return keys;
}

/** The value at `keys`, or undefined when any step is missing. */
const dig = (data: Json, keys: string[]) =>
  keys.reduce<Json | undefined>((o, k) => (o != null && typeof o === 'object' ? (o as JsonObject)[k] : undefined), data);

/** gethomepage's `scale`: a number or a fraction such as "1/1024". */
function scaleOf(scale: number | string | undefined) {
  if (typeof scale === 'string' && scale.includes('/')) {
    const [a, b] = scale.split('/').map(Number);
    return a / b || 1;
  }
  return Number(scale ?? 1) || 1;
}

/**
 * The value as shown: remap first (on the raw value, like gethomepage), then scale, then the format.
 */
export function formatValue(raw: Json, m: CustomApiMapping, now: number) {
  let v = raw;
  for (const r of m.remap ?? []) {
    if (r?.any || r?.value == v) { v = r.to; break; } // loose, as gethomepage: YAML 1 matches "1"
  }
  if (typeof v === 'number') v *= scaleOf(m.scale);
  const n = Number(v);
  const num = (opts: Intl.NumberFormatOptions) => (Number.isFinite(n) && v !== '' && v !== null ? n.toLocaleString('en-US', opts) : String(v));
  const date = () => new Date(v as string | number); // any value: Date gives NaN for what it can't read
  const formats: Partial<Record<NonNullable<CustomApiMapping['format']>, () => string>> = {
    number: () => num({ maximumFractionDigits: 0 }),
    float: () => num({ maximumFractionDigits: 2 }),
    percent: () => `${num({ maximumFractionDigits: 1 })}%`,
    bytes: () => fmtBytes(n),
    bitrate: () => fmtBitrate(n),
    duration: () => fmtDuration(n * 1000),
    date: () => (Number.isNaN(date().getTime()) ? String(v) : date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })),
    relativeDate: () => fmtRelative(date().getTime(), now),
    size: () => String(Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : String(v ?? '').length)
  };
  const shown = formats[m.format ?? 'text']?.() ?? String(v);
  return `${m.prefix ?? ''}${shown}${m.suffix ?? ''}`;
}

/** Whether a threshold is crossed, compared on the raw value after `scale`. */
export function crossed(v: Json, t: Threshold | undefined) {
  if (!t || typeof t !== 'object') return false;
  const n = v === null || v === '' ? NaN : Number(v); // a boolean compares as 0 / 1
  if (t.above != null && Number.isFinite(n) && n > Number(t.above)) return true;
  if (t.below != null && Number.isFinite(n) && n < Number(t.below)) return true;
  if ('equals' in t && String(v) === String(t.equals)) return true;
  if ('not' in t && String(v) !== String(t.not)) return true;
  return false;
}

/** "below 1", "above 90", "is false", "is not ok" — the threshold, for the alert detail. */
const describe = (t: Threshold) => [t.above != null && `above ${t.above}`, t.below != null && `below ${t.below}`, 'equals' in t && `is ${t.equals}`, 'not' in t && `is not ${t.not}`].filter(Boolean).join(', ');

/**
 * One mapping's stat, and its alert when the field is missing or a threshold is crossed.
 */
function readMapping(data: Json, m: CustomApiMapping, i: number, now: number): { stat: Stat; alert: Alert | null } {
  const keys = fieldPath(m.field);
  const label = m.label ?? keys.at(-1) ?? `value ${i + 1}`;
  const raw = dig(data, keys);
  if (raw === undefined) {
    // the path is the user's own config, not upstream content, so it can be shown
    return { stat: { k: label, v: '—', level: 'warn' }, alert: { sev: 'warn', key: `field-${i}`, title: `Field ${keys.join('.')} not found`, detail: `mapping "${label}" in the widget config` } };
  }
  const v = formatValue(raw, m, now);
  const scaled = typeof raw === 'number' ? raw * scaleOf(m.scale) : raw;
  const sev = crossed(scaled, m.crit) ? 'crit' : crossed(scaled, m.warn) ? 'warn' : null;
  return {
    stat: { k: label, v, level: sev },
    alert: sev && { sev, key: `threshold-${i}`, title: `${label.charAt(0).toUpperCase()}${label.slice(1)} is ${v}`, detail: `${sev === 'crit' ? 'critical' : 'warning'} when ${describe(m[sev] as Threshold)}` }
  };
}

async function fetchJson(w: CustomApiWidget, ctx: Context): Promise<Json> {
  const headers: Record<string, string> = { ...(w.headers ?? {}) };
  if (w.username != null || w.password != null) headers.Authorization = basicAuth(w.username, w.password);
  let body: string | undefined;
  if (w.requestBody != null) {
    body = typeof w.requestBody === 'string' ? w.requestBody : JSON.stringify(w.requestBody);
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await ctx.request(w.url, { method: String(w.method ?? 'GET').toUpperCase(), headers, body, insecure: ctx.insecure });
  const text = await res.text();
  // upstream text goes to the log only (err.body): alerts are shown to every viewer
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body: text.slice(0, 300) });
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Response is not JSON'), { body: text.slice(0, 300) });
  }
}

export async function collect(widget: Widget, ctx: Context): Promise<WidgetResult> {
  const w = widget as CustomApiWidget;
  const state = ctx.state as CustomApiState;
  // refreshInterval (ms) is at least the widget interval: in between, the last result stands
  const every = Math.max(Number(w.refreshInterval) || 0, ctx.settings.intervals.widgets * 1000);
  const config = JSON.stringify(w);
  if (state.last && state.lastRun != null && state.config === config && ctx.now - state.lastRun < every - 1000) return state.last;

  const data = await fetchJson(w, ctx);
  const mappings: CustomApiMapping[] = Array.isArray(w.mappings) ? w.mappings : [];
  const read = mappings.map((m, i) => readMapping(data, m, i, ctx.now));
  const stats = read.map((r) => r.stat);
  const alerts = read.flatMap((r) => (r.alert ? [r.alert] : []));
  const first = stats[0];
  const result: WidgetResult = { stats, line: first ? `${first.k} ${first.v}` : 'No mappings', alerts };
  state.last = result;
  state.lastRun = ctx.now;
  state.config = config;
  return result;
}
