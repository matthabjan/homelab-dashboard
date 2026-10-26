// Portainer — X-API-Key, environment id in `env` (same as homepage).
// Containers with label `dashboard.ignore=true` are skipped.
// Containers with gethomepage labels (`homepage.group`, `homepage.name`, `homepage.href`, …) become services.
import { trimUrl } from '../http.js';
/** @import { Alert, Context, Widget, WidgetResult } from '$lib/types' */

/** `homepage.widget.type=x` → { widget: { type: 'x' } }. Values stay literal: no ${SECRET} substitution from labels. */
function fromLabels(labels) {
  /** @type {Record<string, any>} */
  const def = {};
  for (const [k, v] of Object.entries(labels || {})) {
    if (!k.startsWith('homepage.')) continue;
    const parts = k.slice('homepage.'.length).split('.');
    if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let o = def;
    for (const p of parts.slice(0, -1)) o = o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {};
    o[/** @type {string} */ (parts.at(-1))] = v === 'true' ? true : v === 'false' ? false : v;
  }
  if (!def.group || !def.name) return null;
  const { group, name, weight, ...rest } = def;
  return { group: String(group), name: String(name), weight: Number(weight) || 0, def: rest };
}

/**
 * Which exited containers are failures. Exit code 0 is a finished one-shot job, unless the restart policy says the
 * container should be running (a `docker stop`). The policy only changes when the container is recreated, which gives
 * it a new id, so each id is looked up once and kept in `state` while it stays exited.
 * @param {any[]} exited @param {(c: any) => Promise<any>} inspect @param {Record<string, any>} state
 */
async function stoppedContainers(exited, inspect, state) {
  const clean = (c) => /^Exited \(0\)/.test(c.Status);
  /** @type {Record<string, string>} */
  const known = state.restartPolicy ?? {};
  /** @type {Record<string, string>} */
  const policies = (state.restartPolicy = {});
  await Promise.all(exited.filter(clean).map(async (c) => {
    const p = known[c.Id] ?? (await inspect(c))?.HostConfig?.RestartPolicy?.Name;
    if (p != null) policies[c.Id] = p; // a failed lookup is retried next poll
  }));
  const crashed = exited.filter((c) => !clean(c));
  return { crashed, failed: [...crashed, ...exited.filter((c) => clean(c) && /^(always|unless-stopped)$/.test(policies[c.Id] ?? ''))] };
}

/**
 * @param {Widget} w
 * @param {Context} ctx
 * @returns {Promise<WidgetResult>}
 */
export async function collect(w, ctx) {
  const base = `${trimUrl(w.url)}/api/endpoints/${w.env}/docker`;
  const opts = { headers: { 'X-API-Key': w.key }, insecure: ctx.insecure };
  const list = (await ctx.getJson(`${base}/containers/json?all=1`, opts)).filter((c) => c.Labels?.['dashboard.ignore'] !== 'true');

  const running = list.filter((c) => c.State === 'running');
  const exited = list.filter((c) => c.State === 'exited');
  const restarting = list.filter((c) => c.State === 'restarting');
  const unhealthy = running.filter((c) => /\(unhealthy\)/.test(c.Status));
  const inspect = async (c) => {
    try { return await ctx.getJson(`${base}/containers/${c.Id}/json`, opts); } catch { return null; }
  };
  const { crashed, failed } = await stoppedContainers(exited, inspect, ctx.state);

  /** @type {Alert[]} */
  const alerts = [];
  const name = (c) => (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, '');
  // A labelled container without siteMonitor is its own tile, health and alert included: no second alert here.
  const alerting = (cs) => cs.filter((c) => { const d = fromLabels(c.Labels); return !d || d.def.siteMonitor || d.def.probe; });
  for (const c of alerting(restarting)) alerts.push({ sev: 'crit', key: `ct-${name(c)}`, title: `Container ${name(c)} is restarting`, detail: c.Status });
  for (const c of alerting(failed)) {
    // the restart count changes, so a crashed container is looked up every poll, as before
    const n = crashed.includes(c) ? (await inspect(c))?.RestartCount : null;
    alerts.push({ sev: 'warn', key: `ct-${name(c)}`, title: `Container ${name(c)} stopped`, detail: `${c.Status}${n ? ` · ${n} restarts` : ''}` });
  }
  for (const c of alerting(unhealthy)) alerts.push({ sev: 'warn', key: `ct-${name(c)}`, title: `Container ${name(c)} unhealthy`, detail: c.Status });

  // Container state is the health check for discovered services without a siteMonitor.
  // Only stable fields: the Status text ("Up 3 hours") changes every poll.
  const containerOf = (c) => ({
    state: c.State,
    health: c.Status?.match(/\((healthy|unhealthy|health: starting)\)/)?.[1] ?? null,
    exitCode: Number(c.Status?.match(/^Exited \((-?\d+)\)/)?.[1] ?? 0)
  });
  const discovered = list.map((c) => { const d = fromLabels(c.Labels); return d && { ...d, container: containerOf(c) }; }).filter(Boolean)
    .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
    .map(({ weight, ...d }) => d);

  ctx.shared.containers = { running: running.length, total: list.length, failed: failed.length + restarting.length, unhealthy: unhealthy.length };
  const bad = failed.length + restarting.length;
  return {
    stats: [
      { k: 'running', v: String(running.length) },
      { k: 'stopped', v: String(exited.length), level: bad ? 'crit' : null },
      { k: 'unhealthy', v: String(unhealthy.length), level: unhealthy.length ? 'warn' : null }
    ],
    line: `${running.length} / ${list.length} running${bad ? ` · ${bad} failed` : ''}${unhealthy.length ? ` · ${unhealthy.length} unhealthy` : ''}`,
    alerts,
    containers: ctx.shared.containers,
    discovered
  };
}
