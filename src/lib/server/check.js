// Checks: how a service's up/down is found. An HTTP or TCP probe, a label-discovered container's state, or a
// heartbeat. Each reading becomes the same check state, a probe history row (uptime, strips) and the
// "went down" / "recovered" events; `status` turns that into the tile's level, line and alert.
import { insertEvent, insertProbe } from './db.js';
import { reasonText } from './http.js';
import { fmtClock, fmtDuration } from './format.js';
/** @import { CheckKind, CheckState, CheckStatus, ContainerState, HeartbeatState, ProbeResult, Service, ServiceState } from '$lib/types' */

/**
 * A service has at most one check: config.js drops `siteMonitor` when there is a heartbeat, and a container's state
 * is only its check without a siteMonitor.
 * @param {Pick<Service, 'heartbeat' | 'probe' | 'container'>} s
 * @returns {CheckKind | null}
 */
export const kindOf = (s) => (s.heartbeat ? 'heartbeat' : s.probe ? (/^tcp:/i.test(s.probe) ? 'tcp' : 'http') : s.container ? 'container' : null);

/** @returns {CheckState} a check that hasn't run */
export const blankCheck = () => ({ fails: 0, down: false, since: null, reason: null, ms: null, checked: null });

/** @param {ContainerState} c */
const containerReason = ({ state, exitCode }) => `Container ${state}${exitCode ? ` · exit ${exitCode}` : ''}`;

/**
 * Take one reading of a service's check: a `ProbeResult` (http, tcp), its `ContainerState` or its `HeartbeatState`.
 * Updates `st.check` (and `st.heartbeat`), writes the probe history row unless `history` is false, and the events.
 * A probe is down after its second failure in a row; Docker and a heartbeat already know, so they go down at once.
 * A heartbeat that never reported (pending) changes nothing.
 * @param {Service} s @param {ServiceState} st @param {ProbeResult | ContainerState | HeartbeatState} reading @param {number} now
 * @param {{ history?: boolean }} [opts]
 */
export function record(s, st, reading, now, { history = true } = {}) {
  const kind = kindOf(s);
  if (kind === 'heartbeat') {
    const hb = /** @type {HeartbeatState} */ (reading);
    st.heartbeat = hb;
    if (hb.state === 'pending') return;
    if (history) insertProbe(s.id, now, hb.state === 'up', null);
    apply(s, st.check, now, hb.state === 'up' ? null : hb.failed ? 'Reported a failure' : 'Missed its run', 1);
  } else if (kind === 'container') {
    const c = /** @type {ContainerState} */ (reading);
    // unhealthy stays up (the tile warns) but counts as a failure in the history
    if (history) insertProbe(s.id, now, c.state === 'running' && c.health !== 'unhealthy', null);
    apply(s, st.check, now, c.state === 'running' ? null : containerReason(c), 1);
  } else if (kind) {
    const r = /** @type {ProbeResult} */ (reading);
    if (history) insertProbe(s.id, now, r.ok, r.ms);
    st.check.ms = r.ms;
    apply(s, st.check, now, r.ok ? null : reasonText(r.code), 2);
  }
}

/**
 * Up when `reason` is null, else one more failure; down once there are `failuresToDown` in a row.
 * @param {Service} s @param {CheckState} c @param {number} now @param {string | null} reason @param {number} failuresToDown
 */
function apply(s, c, now, reason, failuresToDown) {
  c.checked = now;
  if (reason == null) {
    if (c.down) insertEvent(now, 'ok', s.id, `${s.name} recovered`, `was down since ${fmtClock(c.since)}`);
    Object.assign(c, { fails: 0, down: false, since: null, reason: null });
    return;
  }
  c.fails++;
  if (c.fails === 1) c.since = now;
  c.reason = reason;
  if (c.fails >= failuresToDown && !c.down) {
    c.down = true;
    insertEvent(now, 'crit', s.id, `${s.name} went down`, reason);
  }
}

/**
 * The tile's status from the check; null for a service without one.
 * @param {Service} s @param {ServiceState} st @param {number} now
 * @returns {CheckStatus | null}
 */
export function status(s, st, now) {
  const kind = kindOf(s);
  const c = st.check;
  if (kind === 'heartbeat') return heartbeatStatus(/** @type {NonNullable<Service['heartbeat']>} */ (s.heartbeat), st.heartbeat, now);
  if (!kind) return null;
  if (c.down) {
    const since = /** @type {number} */ (c.since);
    return { lvl: 'crit', status: 'Down', line: `Down since ${fmtClock(since)} · ${c.reason}`, lineLevel: 'crit', alert: { sev: 'crit', title: 'is down', detail: `${c.reason} · since ${fmtClock(since)}`, ts: since } };
  }
  if (kind === 'container') return containerStatus(/** @type {ContainerState} */ (s.container));
  return c.checked ? { lvl: 'ok', status: 'Up', line: null } : { lvl: 'unknown', status: 'Checking', line: null };
}

/**
 * A label-discovered container that isn't down (yet): the container widget raises its other alerts.
 * @param {ContainerState} c
 * @returns {CheckStatus}
 */
function containerStatus(c) {
  if (c.state === 'running' && c.health === 'unhealthy') return { lvl: 'warn', status: 'Unhealthy', line: 'Container unhealthy', alert: { sev: 'warn', title: 'is unhealthy', detail: 'container health check failing' } };
  if (c.state === 'running') return { lvl: 'ok', status: 'Up', line: null };
  return { lvl: 'crit', status: 'Down', line: containerReason(c) };
}

/**
 * When the job last ran, or since when it is overdue or failed.
 * @param {NonNullable<Service['heartbeat']>} hb @param {HeartbeatState | null | undefined} st @param {number} now
 * @returns {CheckStatus}
 */
function heartbeatStatus(hb, st, now) {
  const every = `every ${fmtDuration(hb.every)}`;
  if (!st || st.state === 'pending') return { lvl: 'unknown', status: 'Waiting', line: `Waiting for the first run · ${every}`, lineLevel: 'muted' };
  const last = st.lastOk != null ? `last run ${fmtDuration(now - st.lastOk)} ago` : 'never ran';
  if (st.failed) {
    const at = /** @type {number} */ (st.lastFail);
    return { lvl: 'crit', status: 'Down', line: `Reported failure ${fmtClock(at)}`, alert: { sev: 'crit', title: 'reported a failure', detail: `${fmtClock(at)} · ${last}`, ts: at } };
  }
  if (st.state === 'down') {
    const since = /** @type {number} */ (st.overdueSince);
    return { lvl: 'crit', status: 'Down', line: `Overdue since ${fmtClock(since)}`, alert: { sev: 'crit', title: 'missed its run', detail: `${last} · ${every}`, ts: since } };
  }
  return { lvl: 'ok', status: 'Up', line: `Last run ${fmtDuration(now - /** @type {number} */ (st.lastOk))} ago · ${every}`, lineLevel: null };
}
