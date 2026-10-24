// Portainer — X-API-Key, environment id in `env` (same as homepage).
// Containers with label `dashboard.ignore=true` are skipped.
// Containers with gethomepage labels (`homepage.group`, `homepage.name`, `homepage.href`, …) become services.
import { getJson, trimUrl } from '../http.js';

/** `homepage.widget.type=x` → { widget: { type: 'x' } }. Values stay literal: no ${SECRET} substitution from labels. */
function fromLabels(labels) {
  const def = {};
  for (const [k, v] of Object.entries(labels || {})) {
    if (!k.startsWith('homepage.')) continue;
    const parts = k.slice('homepage.'.length).split('.');
    if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let o = def;
    for (const p of parts.slice(0, -1)) o = o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {};
    o[parts.at(-1)] = v === 'true' ? true : v === 'false' ? false : v;
  }
  if (!def.group || !def.name) return null;
  const { group, name, weight, ...rest } = def;
  return { group: String(group), name: String(name), weight: Number(weight) || 0, def: rest };
}

export async function collect(w, ctx) {
  const base = `${trimUrl(w.url)}/api/endpoints/${w.env}/docker`;
  const opts = { headers: { 'X-API-Key': w.key }, insecure: ctx.insecure };
  const list = (await getJson(`${base}/containers/json?all=1`, opts)).filter((c) => c.Labels?.['dashboard.ignore'] !== 'true');

  const running = list.filter((c) => c.State === 'running');
  const exited = list.filter((c) => c.State === 'exited');
  const restarting = list.filter((c) => c.State === 'restarting');
  const unhealthy = running.filter((c) => /\(unhealthy\)/.test(c.Status));
  const failed = exited.filter((c) => !/Exited \(0\)/.test(c.Status)); // exit code 0 = finished one-shot job

  const alerts = [];
  const name = (c) => (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, '');
  const restartsOf = async (c) => {
    try { return (await getJson(`${base}/containers/${c.Id}/json`, opts)).RestartCount ?? 0; } catch { return null; }
  };
  for (const c of restarting) alerts.push({ sev: 'crit', key: `ct-${name(c)}`, title: `Container ${name(c)} is restarting`, detail: c.Status });
  for (const c of failed) {
    const n = await restartsOf(c);
    alerts.push({ sev: 'warn', key: `ct-${name(c)}`, title: `Container ${name(c)} stopped`, detail: `${c.Status}${n ? ` · ${n} restarts` : ''}` });
  }
  for (const c of unhealthy) alerts.push({ sev: 'warn', key: `ct-${name(c)}`, title: `Container ${name(c)} unhealthy`, detail: c.Status });

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
