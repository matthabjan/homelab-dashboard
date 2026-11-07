// Home Assistant — a long-lived access token (homepage: `key`), as a Bearer header. A non-admin user's token is enough,
// except for `template` entries in `custom`, which Home Assistant allows admins only.
// Pending updates (core, OS, add-ons, HACS, device firmware: every `update.*` entity that is on) and low batteries
// are notes in Activity; `custom` adds entity states or templates as stats, like homepage.
import { trimUrl } from '../http.ts';
import { card, plural } from '../format.ts';
import type { Alert, Context, Json, Stat, Widget, WidgetResult } from '$lib/types';

/** GET /api/config, the fields read here. */
export interface HassConfig {
  version?: string;
  location_name?: string;
}

/** An entry of GET /api/states. */
export interface HassState {
  entity_id: string;
  state: string;
  attributes?: { [key: string]: Json | undefined };
}

/** One `custom` entry, as homepage has it: an entity's state, or a template rendered by Home Assistant. */
interface HassCustom {
  state?: string;
  template?: string;
  label?: string;
  /** "{state} {attributes.unit_of_measurement}" by default */
  value?: string;
}

/** `batteryLow`, our addition: the % below which a battery is a note (default 20). */
type HassWidget = Widget & { key?: string; custom?: HassCustom[]; batteryLow?: number | string };

const text = (v: Json | undefined) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const nameOf = (s: HassState) => text(s.attributes?.friendly_name) || s.entity_id;

/** homepage's value template: `{state}` and `{attributes.x}` from the entity. */
const fill = (template: string, s: HassState) =>
  template.replace(/\{(state|attributes\.([\w-]+))\}/g, (_m, _key: string, attr?: string) => (attr ? text(s.attributes?.[attr]) : s.state)).trim();

/** Every `update.*` entity that is on, as a note: "Home Assistant Core 2026.11.1 available". */
function updateAlerts(states: HassState[]): Alert[] {
  return states.filter((s) => s.entity_id.startsWith('update.') && s.state === 'on').map((s) => {
    const a = s.attributes ?? {};
    const latest = text(a.latest_version);
    return { sev: 'info', key: `update-${s.entity_id}`, title: `${text(a.title) || nameOf(s)}${latest ? ` ${latest}` : ''} available`, detail: a.installed_version ? `installed ${text(a.installed_version)}` : 'update available' };
  });
}

/** Battery sensors below `low` %, and battery binary sensors that report low. */
function batteryAlerts(states: HassState[], low: number): Alert[] {
  const alerts: Alert[] = [];
  // "Front door Battery" → "Front door", so the title can say "Front door battery at 9%"
  const device = (s: HassState) => nameOf(s).replace(/\s+battery(\s+(level|low))?$/i, '');
  for (const s of states) {
    if (s.attributes?.device_class !== 'battery') continue;
    const level = Number(s.state);
    if (s.entity_id.startsWith('sensor.') && s.attributes.unit_of_measurement === '%' && s.state !== '' && level < low) {
      alerts.push({ sev: 'info', key: `battery-${s.entity_id}`, title: `${device(s)} battery at ${Math.round(level)}%`, detail: `below ${low}%` });
    }
    if (s.entity_id.startsWith('binary_sensor.') && s.state === 'on') alerts.push({ sev: 'info', key: `battery-${s.entity_id}`, title: `${device(s)} battery low`, detail: 'the device reports its battery as low' });
  }
  return alerts;
}

/** The `custom` entries as stats; one that can't be read shows "—" instead of failing the widget. */
async function customFacts(custom: HassCustom[], states: HassState[], render: (template: string) => Promise<string>): Promise<[Stat, string][]> {
  return Promise.all(custom.map(async (c, i): Promise<[Stat, string]> => {
    let label = c.label ?? `value ${i + 1}`, v = '—';
    if (c.template) {
      try { v = (await render(c.template)).trim() || '—'; } catch { /* admin only, or a template error: shown as — */ }
    } else if (c.state) {
      const s = states.find((x) => x.entity_id === c.state);
      label = c.label ?? (s ? nameOf(s) : c.state);
      if (s) v = fill(c.value ?? '{state} {attributes.unit_of_measurement}', s) || '—';
    }
    return [{ k: label, v }, `${label} ${v}`];
  }));
}

export async function collect(widget: Widget, ctx: Context): Promise<WidgetResult> {
  const w = widget as HassWidget;
  const base = trimUrl(w.url) + '/api';
  const headers = { Authorization: `Bearer ${w.key ?? w.password ?? ''}` };
  const opts = { headers, insecure: ctx.insecure };
  const [config, states] = await Promise.all([ctx.getJson<HassConfig>(`${base}/config`, opts), ctx.getJson<HassState[]>(`${base}/states`, opts)]);
  if (!Array.isArray(states)) throw new Error('Unexpected answer from /api/states');

  const render = async (template: string) => {
    const res = await ctx.request(`${base}/template`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ template }), insecure: ctx.insecure });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  };
  const updates = updateAlerts(states);
  const batteries = batteryAlerts(states, Number(w.batteryLow) || 20);
  const unavailable = states.filter((s) => s.state === 'unavailable').length;

  const facts: [Stat, string][] = [
    [{ k: 'updates', v: String(updates.length) }, updates.length ? `${plural(updates.length, 'update')} available` : 'Up to date'],
    ...(await customFacts(Array.isArray(w.custom) ? w.custom : [], states, render))
  ];
  if (config.version) facts.push([{ k: 'version', v: config.version }, `Home Assistant ${config.version}`]);
  if (unavailable) facts.push([{ k: 'unavailable', v: String(unavailable) }, `${plural(unavailable, 'entity', 'entities')} unavailable`]);
  if (batteries.length) facts.push([{ k: 'low batteries', v: String(batteries.length) }, plural(batteries.length, 'low battery', 'low batteries')]);
  return { ...card(facts), alerts: [...updates, ...batteries] };
}
