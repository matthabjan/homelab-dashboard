// Checks: how a service's up/down is found. An HTTP or TCP probe, a label-discovered container's state, or a
// heartbeat. Each reading becomes the same check state, a probe history row (uptime, strips) and the
// "went down" / "recovered" events; `status` turns that into the tile's level, line and alert.
import { insertEvent, insertProbe } from './db.ts';
import { reasonText } from './http.ts';
import { fmtClock, fmtDuration } from './format.ts';
import type { CheckKind, CheckState, CheckStatus, ContainerState, HeartbeatState, ProbeResult, Service, ServiceState } from '$lib/types';

/**
 * A service has at most one check: config.ts drops `siteMonitor` when there is a heartbeat, and a container's state
 * is only its check without a siteMonitor.
 */
export const kindOf = (s: Pick<Service, 'heartbeat' | 'probe' | 'container'>): CheckKind | null => (s.heartbeat ? 'heartbeat' : s.probe ? (/^tcp:/i.test(s.probe) ? 'tcp' : 'http') : s.container ? 'container' : null);

/** @returns a check that hasn't run */
export const blankCheck = (): CheckState => ({ fails: 0, down: false, since: null, reason: null, ms: null, checked: null });

const containerReason = ({ state, exitCode }: ContainerState) => `Container ${state}${exitCode ? ` · exit ${exitCode}` : ''}`;

/**
 * Take one reading of a service's check: a `ProbeResult` (http, tcp), its `ContainerState` or its `HeartbeatState`.
 * Updates `st.check` (and `st.heartbeat`), writes the probe history row unless `history` is false, and the events.
 * A probe is down after its second failure in a row; Docker and a heartbeat already know, so they go down at once.
 * A heartbeat that never reported (pending) changes nothing.
 */
export function record(s: Service, st: ServiceState, reading: ProbeResult | ContainerState | HeartbeatState, now: number, { history = true }: { history?: boolean } = {}) {
  const kind = kindOf(s);
  if (kind === 'heartbeat') {
    const hb = (reading as HeartbeatState);
    st.heartbeat = hb;
    if (hb.state === 'pending') return;
    if (history) insertProbe(s.id, now, hb.state === 'up', null);
    apply(s, st.check, now, hb.state === 'up' ? null : hb.failed ? 'Reported a failure' : 'Missed its run', 1);
  } else if (kind === 'container') {
    const c = (reading as ContainerState);
    // unhealthy stays up (the tile warns) but counts as a failure in the history; a finished one-shot job is up
    const up = c.state === 'running' || c.done;
    if (history) insertProbe(s.id, now, up && c.health !== 'unhealthy', null);
    apply(s, st.check, now, up ? null : containerReason(c), 1);
  } else if (kind) {
    const r = (reading as ProbeResult);
    if (history) insertProbe(s.id, now, r.ok, r.ms);
    st.check.ms = r.ms;
    apply(s, st.check, now, r.ok ? null : reasonText(r.code), 2);
  }
}

/**
 * Up when `reason` is null, else one more failure; down once there are `failuresToDown` in a row.
 */
function apply(s: Service, c: CheckState, now: number, reason: string | null, failuresToDown: number) {
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
 */
export function status(s: Service, st: ServiceState, now: number): CheckStatus | null {
  const kind = kindOf(s);
  const c = st.check;
  if (kind === 'heartbeat') return heartbeatStatus((s.heartbeat as NonNullable<Service['heartbeat']>), st.heartbeat, now);
  if (!kind) return null;
  if (c.down) {
    const since = (c.since as number);
    return { lvl: 'crit', status: 'Down', line: `Down since ${fmtClock(since)} · ${c.reason}`, lineLevel: 'crit', alert: { sev: 'crit', title: 'is down', detail: `${c.reason} · since ${fmtClock(since)}`, ts: since } };
  }
  if (kind === 'container') return containerStatus((s.container as ContainerState));
  return c.checked ? { lvl: 'ok', status: 'Up', line: null } : { lvl: 'unknown', status: 'Checking', line: null };
}

/**
 * A label-discovered container that isn't down (yet): the container widget raises its other alerts.
 */
function containerStatus(c: ContainerState): CheckStatus {
  if (c.state === 'running' && c.health === 'unhealthy') return { lvl: 'warn', status: 'Unhealthy', line: 'Container unhealthy', alert: { sev: 'warn', title: 'is unhealthy', detail: 'container health check failing' } };
  if (c.state === 'running') return { lvl: 'ok', status: 'Up', line: null };
  if (c.done) return { lvl: 'ok', status: 'Done', line: 'Job finished', lineLevel: 'muted' };
  return { lvl: 'crit', status: 'Down', line: containerReason(c) };
}

/**
 * When the job last ran, or since when it is overdue or failed.
 */
function heartbeatStatus(hb: NonNullable<Service['heartbeat']>, st: HeartbeatState | null | undefined, now: number): CheckStatus {
  const every = `every ${fmtDuration(hb.every)}`;
  if (!st || st.state === 'pending') return { lvl: 'unknown', status: 'Waiting', line: `Waiting for the first run · ${every}`, lineLevel: 'muted' };
  const last = st.lastOk != null ? `last run ${fmtDuration(now - st.lastOk)} ago` : 'never ran';
  if (st.failed) {
    const at = (st.lastFail as number);
    return { lvl: 'crit', status: 'Down', line: `Reported failure ${fmtClock(at)}`, alert: { sev: 'crit', title: 'reported a failure', detail: `${fmtClock(at)} · ${last}`, ts: at } };
  }
  if (st.state === 'down') {
    const since = (st.overdueSince as number);
    return { lvl: 'crit', status: 'Down', line: `Overdue since ${fmtClock(since)}`, alert: { sev: 'crit', title: 'missed its run', detail: `${last} · ${every}`, ts: since } };
  }
  return { lvl: 'ok', status: 'Up', line: `Last run ${fmtDuration(now - (st.lastOk as number))} ago · ${every}`, lineLevel: null };
}
