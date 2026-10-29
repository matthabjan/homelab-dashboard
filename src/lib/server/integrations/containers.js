// Docker Engine API logic shared by the portainer widget (through Portainer's proxy) and the docker widget (a socket proxy):
// container counts, failed and unhealthy containers, and services from `dashboard.*` labels.
// Containers with label `dashboard.ignore=true` are skipped.
/** @import { Alert, ContainerCounts, ContainerState, Context, RequestOptions, WidgetResult } from '$lib/types' */

/** `dashboard.widget.type=x` → { widget: { type: 'x' } }. Values stay literal: no ${SECRET} substitution from labels. */
export function fromLabels(labels) {
  /** @type {Record<string, any>} */
  const def = {};
  for (const [k, v] of Object.entries(labels || {})) {
    if (!k.startsWith('dashboard.')) continue;
    const parts = k.slice('dashboard.'.length).split('.');
    if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let o = def;
    for (const p of parts.slice(0, -1)) o = o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {};
    o[/** @type {string} */ (parts.at(-1))] = v === 'true' ? true : v === 'false' ? false : v;
  }
  if (!def.group || !def.name) return null;
  const { group, name, weight, ignore, ...rest } = def;
  return { group: String(group), name: String(name), weight: Number(weight) || 0, def: rest };
}

/**
 * Which exited containers are failures. Exit code 0 is a finished one-shot job, unless the restart policy says the
 * container should be running (a `docker stop`). The policy only changes when the container is recreated, which gives
 * it a new id, so each id is looked up once and kept in `state` while it stays exited.
 * @param {any[]} exited @param {(c: any) => Promise<any>} inspect @param {Record<string, any>} state
 */
export async function failedExit(exited, inspect, state) {
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
 * Container state is the health check for discovered services without a siteMonitor.
 * Only stable fields: the Status text ("Up 3 hours") changes every poll.
 * @returns {ContainerState}
 */
export const containerOf = (c) => ({
  state: c.State,
  health: c.Status?.match(/\((healthy|unhealthy|health: starting)\)/)?.[1] ?? null,
  exitCode: Number(c.Status?.match(/^Exited \((-?\d+)\)/)?.[1] ?? 0)
});

/** The engine's id from /info, looked up once per service; the base URL when /info isn't allowed. */
async function engineId(base, opts, ctx) {
  ctx.state.engineId ??= (await ctx.getJson(`${base}/info`, opts).catch(() => null))?.ID ?? null;
  return ctx.state.engineId ?? base;
}

/**
 * Alerts for restarting, failed and unhealthy containers. A labelled container without siteMonitor is its own tile,
 * health and alert included, so it gets no second alert here.
 * @returns {Promise<Alert[]>}
 */
async function containerAlerts({ restarting, failed, crashed, unhealthy }, inspect) {
  /** @type {Alert[]} */
  const alerts = [];
  const name = (c) => (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, '');
  const alerting = (cs) => cs.filter((c) => { const d = fromLabels(c.Labels); return !d || d.def.siteMonitor || d.def.probe; });
  for (const c of alerting(restarting)) alerts.push({ sev: 'crit', key: `ct-${name(c)}`, title: `Container ${name(c)} is restarting`, detail: c.Status });
  for (const c of alerting(failed)) {
    // the restart count changes, so a crashed container is looked up every poll
    const n = crashed.includes(c) ? (await inspect(c))?.RestartCount : null;
    alerts.push({ sev: 'warn', key: `ct-${name(c)}`, title: `Container ${name(c)} stopped`, detail: `${c.Status}${n ? ` · ${n} restarts` : ''}` });
  }
  for (const c of alerting(unhealthy)) alerts.push({ sev: 'warn', key: `ct-${name(c)}`, title: `Container ${name(c)} unhealthy`, detail: c.Status });
  return alerts;
}

/**
 * Everything a container widget reports, from a Docker Engine API at `base`.
 * @param {string} base @param {RequestOptions} opts @param {Context} ctx
 * @returns {Promise<WidgetResult>}
 */
export async function collectContainers(base, opts, ctx) {
  const list = (await ctx.getJson(`${base}/containers/json?all=1`, opts)).filter((c) => c.Labels?.['dashboard.ignore'] !== 'true');

  const running = list.filter((c) => c.State === 'running');
  const exited = list.filter((c) => c.State === 'exited');
  const restarting = list.filter((c) => c.State === 'restarting');
  const unhealthy = running.filter((c) => /\(unhealthy\)/.test(c.Status));
  const inspect = async (c) => {
    try { return await ctx.getJson(`${base}/containers/${c.Id}/json`, opts); } catch { return null; }
  };
  const { crashed, failed } = await failedExit(exited, inspect, ctx.state);

  const alerts = await containerAlerts({ restarting, failed, crashed, unhealthy }, inspect);
  const discovered = list.map((c) => { const d = fromLabels(c.Labels); return d && { ...d, container: containerOf(c), image: c.Image ?? null }; }).filter(Boolean)
    .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
    .map(({ weight, ...d }) => d);

  /** @type {ContainerCounts} */
  const containers = { running: running.length, total: list.length, failed: failed.length + restarting.length, unhealthy: unhealthy.length };
  // keyed by Docker engine, so Portainer and a docker widget on the same engine count its containers once
  (ctx.shared.containers ??= {})[await engineId(base, opts, ctx)] = containers;
  const bad = failed.length + restarting.length;
  return {
    stats: [
      { k: 'running', v: String(running.length) },
      { k: 'stopped', v: String(exited.length), level: bad ? 'crit' : null },
      { k: 'unhealthy', v: String(unhealthy.length), level: unhealthy.length ? 'warn' : null }
    ],
    line: `${running.length} / ${list.length} running${bad ? ` · ${bad} failed` : ''}${unhealthy.length ? ` · ${unhealthy.length} unhealthy` : ''}`,
    alerts,
    containers,
    discovered
  };
}
