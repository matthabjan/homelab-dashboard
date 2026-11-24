// Turns engine state + history into the JSON the browser renders.
import fs from 'node:fs';
import { resolveIcon, assetUrl, darkAssetUrl, serviceById } from './config.ts';
import { probeStats, uptimeSince, probeBuckets, probeDays, eventLevels, series, recentEvents, openScores, type ProbeBucketRow } from './db.ts';
import { hostService, hostSource } from './local.ts';
import { heartbeatStatus, kindOf, status as checkStatus, withoutBlips } from './check.ts';
import { createAttention, type Raised } from './attention.ts';
import { infrastructure } from './infrastructure.ts';
import { backups as backupsOf, isBackupService, DAYS } from './backups.ts';
import { storage as storageOf } from './storage.ts';
import { system, type History } from './system.ts';
import { drives as drivesOf } from './drives.ts';
import { network as networkOf } from './network.ts';
import { fleet as fleetOf, BUCKETS, BUCKET_MS } from './fleet.ts';
import { verdict as verdictOf } from './verdict.ts';
import type { AttentionItem, ConfigProblem, Job, Level, Settings, Severity, SheetRef, Snapshot, Tile, Trend } from '#lib/types';
import type { Engine } from './engine.ts';

const RANK: Record<Severity | Level, number> = { crit: 3, warn: 2, info: 1, ok: 0 };
// shown in the footer; package.json sits in the working directory in the image (/app) and in a checkout
const VERSION = (() => { try { return String(JSON.parse(fs.readFileSync('package.json', 'utf8')).version); } catch { return null; } })();
const H = 3600_000;
const MIN_SLOW_SAMPLES = 10; // ~5 min of probes before a service can be called slow

/** What the snapshot reads from the engine; the Engine itself satisfies it. */
export type SnapshotInput = Pick<Engine, 'cfg' | 'state' | 'autoIcons' | 'iconVariants' | 'shared' | 'temps' | 'local'>;
type ProbeSummary = { up24: number | null; p95: number | null; p95h: number | null; n1: number; up7: number | null };
type Series = ReturnType<typeof series>;
type BackupHistory = { checks: ReturnType<typeof probeDays>; events: ReturnType<typeof eventLevels> };
/** History as it was read this minute: each kind of query in a slot of its own type. */
type Minute = { ts: number; stats: Map<string, ProbeSummary>; series: Map<string, Series>; fleet?: ProbeBucketRow[]; backupDays?: BackupHistory };
/** What a builder carries from one snapshot to the next. */
type Memory = { minute: Minute; attention: ReturnType<typeof createAttention> };
const blankMinute = (ts: number): Minute => ({ ts, stats: new Map(), series: new Map() });

/**
 * A snapshot builder. It remembers when each alert first appeared (so attention shows "since" instead of
 * "last polled") and keeps history queries for a minute, so keep one per engine.
 */
export function createSnapshot(): (input: SnapshotInput, now: number) => Snapshot {
  const mem: Memory = { minute: blankMinute(0), attention: createAttention() };
  return (input, now) => build(input, now, mem);
}

/**
 * This minute's history: the snapshot is rebuilt after every round and heartbeat, and the history queries behind it
 * (probe statistics, the 24 h strips, the gauges' series) are most of its cost (the strip ~80 ms at 30 services), so
 * each is read once a minute. History moves on by a probe or two in that minute.
 */
function minute(mem: Memory, now: number): Minute {
  if (now - mem.minute.ts > 60_000) mem.minute = blankMinute(now);
  return mem.minute;
}
/** `read()` once per key of a minute's slot. */
function once<V>(slot: Map<string, V>, key: string, read: () => V): V {
  let v = slot.get(key);
  if (v === undefined) slot.set(key, (v = read()));
  return v;
}

function stats(mem: Memory, sid: string, now: number): ProbeSummary {
  return once(minute(mem, now).stats, sid, () => {
    const d = probeStats(sid, now - 24 * H);
    const h1 = probeStats(sid, now - H);
    return { up24: d.uptime, p95: d.p95, p95h: h1.p95, n1: h1.n, up7: uptimeSince(sid, now - 7 * 24 * H) };
  });
}

/** A metric's 24 h series in `points` buckets. */
const series24 = (mem: Memory, now: number, key: string, points: number): Series => once(minute(mem, now).series, `${key} ${points}`, () => series(key, now - 24 * H, now, points));

/** A metric's 24 h trend, or null while it has fewer than two samples (nothing to draw). */
const trend24 = (mem: Memory, now: number, key: string | undefined, points: number): Trend | null => {
  if (!key) return null;
  const s = series24(mem, now, key, points);
  return s.values.filter((v) => v != null).length > 1 ? { values: s.values, from: s.from } : null;
};

/**
 * A service's or link's icon in both themes: its own `iconDark`, else the measured variant of its configured icon (one
 * that would vanish in a theme), else the automatic icon with its variant.
 */
function themed(engine: SnapshotInput, name: string, icon: string | null | undefined, iconDark: string | null | undefined, auto?: { icon: string; iconDark: string | null } | null) {
  const url = resolveIcon(icon ?? auto?.icon, name);
  if (iconDark) return { icon: url, iconDark: resolveIcon(iconDark, name) };
  const v = icon ? engine.iconVariants.get(url) : undefined;
  if (v) return { icon: v.icon, iconDark: v.iconDark };
  return { icon: url, iconDark: auto?.iconDark ? resolveIcon(auto.iconDark, name) : null };
}

type Round = ReturnType<Memory['attention']['begin']>;
/** Every service that has polled its widget at least once, with that result. */
const widgetsOf = (engine: SnapshotInput) => engine.cfg.services.flatMap((s) => {
  const w = engine.state(s.id).widget;
  return w ? [{ s, w }] : [];
});

/** A config file with an error: one alert per file, however many problems it has (/config lists each of them). */
function configAlerts(engine: SnapshotInput, round: Round) {

  // a config file with an error: keeping its last version is a warning, losing its content is critical
  const shown: Record<string, string> = { last: 'showing the last working version', none: 'nothing loaded from it', null: 'the rest of the file is loaded' };
  const byFile = new Map<string, ConfigProblem[]>();
  for (const p of engine.cfg.problems ?? []) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
  for (const [file, list] of byFile) {
    const [first] = list;
    round.raise({
      sev: list.some((p) => p.fallback === 'none') ? 'crit' : 'warn',
      source: 'config',
      key: file,
      title: list.length === 1 ? `${file} has an error` : `${file} has ${list.length} problems`,
      detail: list.length === 1 ? `${first.message} · ${shown[String(first.fallback)]}` : `${first.message}, and ${list.length - 1} more`,
      href: '/config#problems'
    });
  }
}

/**
 * The sheet an event's row in Activity opens: what a backup service reported (backups completed) the Backups sheet,
 * anything else about a service (an outage, an update) that service's sheet.
 */
function feedTarget(engine: SnapshotInput, sid: string | null, reported: boolean): SheetRef | null {
  const s = sid ? serviceById(engine.cfg).get(sid) : undefined;
  if (!s) return null;
  return reported && isBackupService(s) ? { kind: 'infra', tab: 'backups' } : { kind: 'service', id: s.id };
}

/** The same for a note: a PBS widget's (an offsite disk detached) the Backups sheet, the host's the System tab. */
function noteTarget(engine: SnapshotInput, a: AttentionItem): SheetRef | null {
  if (a.sid) return feedTarget(engine, a.sid, a.key.startsWith(`${a.sid}|widget-`));
  return a.key.startsWith('host|') ? { kind: 'infra', tab: 'system' } : null;
}

/** A tile per service, from its check, certificate and widget; raises what is wrong with each. */
function serviceTiles(engine: SnapshotInput, now: number, mem: Memory, round: Round): Map<string, Tile> {
  const { groups, settings } = engine.cfg;
  const th = settings.thresholds;
  const tiles: Map<string, Tile> = new Map();
  for (const g of groups) {
    for (const s of g.services) {
      const st = engine.state(s.id);
      const c = st.check;
      const w = st.widget;
      const kind = kindOf(s);
      const ps = kind ? stats(mem, s.id, now) : null; // container and heartbeat states are recorded like probes
      const host = (() => { try { return new URL(s.href || s.probe || '').host; } catch { return ''; } })();
      const cs = checkStatus(s, st, now);
      let lvl: Tile['level'] = cs ? cs.lvl : w ? 'ok' : 'unknown';
      let status = cs ? cs.status : w ? 'Up' : 'Checking';
      let line = w?.line || s.description || '';
      let lineLevel: Tile['lineLevel'] = null;
      if (cs?.line) { line = cs.line; lineLevel = cs.lineLevel !== undefined ? cs.lineLevel : lvl === 'unknown' ? 'muted' : lvl; }
      const auto = s.icon ? null : engine.autoIcons.get(s.id);

      const raise = (a: Omit<Raised, 'service' | 'source'>) => round.raise({ ...a, ts: a.ts ?? w?.ts, service: s });
      if (cs?.alert) raise({ ...cs.alert, key: 'check', title: `${s.name} ${cs.alert.title}` });

      const slowMs = s.latencyWarnMs ?? th.latencyWarnMs;
      if (!c.down && ps?.p95h != null && ps.n1 >= MIN_SLOW_SAMPLES && ps.p95h > slowMs) {
        lvl = 'warn';
        status = 'Slow';
        raise({ sev: 'warn', key: 'slow', title: `${s.name} is slow`, detail: `p95 ${Math.round(ps.p95h)} ms over the last hour · limit ${slowMs} ms` });
        if (!w) { line = `Slow · p95 ${Math.round(ps.p95h)} ms`; lineLevel = 'warn'; }
      }

      let cert = null;
      if (st.cert) {
        const days = Math.floor((st.cert.validTo - now) / 86_400_000);
        cert = { days, selfSigned: st.cert.selfSigned };
        if (days < th.certWarnDays) {
          raise({ sev: days < 3 ? 'crit' : 'warn', key: 'cert', title: days < 0 ? 'Certificate expired' : `Certificate expires in ${days} d`, detail: host });
        }
      }

      if (w) {
        for (const a of w.alerts || []) raise({ ...a, key: `widget-${a.key}` });
        if (!w.ok) {
          raise({ sev: 'info', key: 'stats', title: 'stats unavailable', detail: w.error });
          if (!lineLevel) { line = 'Stats unavailable'; lineLevel = 'muted'; }
        }
      }

      tiles.set(s.id, {
        id: s.id,
        name: s.name,
        group: s.group,
        description: s.description,
        href: s.href,
        host,
        ...themed(engine, s.name, s.icon, s.iconDark, auto),
        level: lvl,
        status,
        line,
        lineLevel,
        stats: w?.stats || [],
        uptime24: ps?.up24 ?? null,
        uptime7: ps?.up7 ?? null,
        p95: ps?.p95 ?? null,
        check: kind,
        cert,
        beats: null
      });
    }
  }
  return tiles;
}

/** The machine on the System panel: the Proxmox node (with its service) when host.source picks it, else the local host. */
function hostReading(engine: SnapshotInput) {
  const service = hostSource(engine.cfg) === 'proxmox' ? hostService(engine.cfg) : undefined;
  return { service, hw: service ? engine.state(service.id).widget?.host : engine.local };
}

/** After attention closed: each tile takes its worst alert when that is worse than its check says. */
function applyWorst(tiles: Map<string, Tile>, att: ReturnType<Round['close']>) {
  for (const t of tiles.values()) {
    const top = t.level === 'unknown' ? null : att.worst(t.id);
    if (top && RANK[top.sev] > RANK[t.level as Level]) {
      t.level = top.sev;
      t.line = top.detail ? `${top.title} · ${top.detail}` : top.title;
      t.lineLevel = top.sev;
    }
    t.line ||= t.level === 'ok' ? 'Online' : '';
  }
}

/** Heartbeat services with their schedule: when each last ran, when the next run is due, and its state in short. */
function jobList(engine: SnapshotInput, now: number): Job[] {
  return engine.cfg.services.flatMap((s) => {
    const hb = s.heartbeat;
    if (!hb) return [];
    const st = engine.state(s.id).heartbeat;
    const last = st?.lastOk ?? null;
    const { lvl, word } = heartbeatStatus(hb, st, now);
    return [{
      id: s.id, name: s.name, group: s.group, href: s.href ?? null, description: s.description ?? '',
      every: hb.every, grace: hb.grace, lastOk: last, lastFail: st?.lastFail ?? null,
      due: (last ?? st?.since ?? now) + hb.every,
      state: st?.state ?? 'pending', failed: st?.failed ?? false, backup: hb.backup,
      status: word ?? '', level: lvl === 'unknown' ? 'none' : lvl
    }];
  });
}

/** The Most used row: services with a link, by their decaying open score, ties in services.yaml order. */
function mostUsedRow(all: Tile[], settings: Settings, now: number): Tile[] {
  const scores = openScores(now, settings.mostUsed.halfLifeDays);
  const mostUsed = all
    .filter((t) => t.href && scores[t.id] > 0)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => scores[b.t.id] - scores[a.t.id] || a.i - b.i)
    .slice(0, Math.max(0, settings.mostUsed.count))
    .map((x) => x.t);
  return mostUsed;
}

function build(engine: SnapshotInput, now: number, mem: Memory): Snapshot {
  const { settings, groups, bookmarks } = engine.cfg;
  const th = settings.thresholds;
  // everything is raised first: a tile is as bad as the worst alert raised for its service, wherever it came from
  const round = mem.attention.begin(now);
  configAlerts(engine, round);
  const tiles = serviceTiles(engine, now, mem, round);
  const reading = hostReading(engine);
  const reports = engine.cfg.services.flatMap((s) => { const rows = engine.state(s.id).widget?.storage; return rows?.length ? [{ service: s, rows }] : []; });
  const disks = storageOf(reports, reading.hw ? { service: reading.service, node: reading.hw.node, disk: reading.hw.disk } : null, th, (m) => trend24(mem, now, m, 48));
  const history: History = (key, points) => series24(mem, now, key, points);
  const sys = system({ service: reading.service, hw: reading.hw, temps: engine.temps, diskLevel: disks.gaugeLevel, host: settings.host, thresholds: th }, history);
  const host = sys.host;
  for (const a of sys.raised) round.raise(a);
  for (const a of disks.raised) round.raise(a);
  const storage = disks.rows;
  const disksOf = drivesOf(engine.cfg.services.map((service) => ({ service, drives: engine.state(service.id).widget?.drives ?? [] })), th);
  for (const a of disksOf.raised) round.raise(a);
  const drives = disksOf.rows;

  // short outages stay out of Activity, so more are read than are shown
  const events = withoutBlips(recentEvents(now - 24 * H, 60), now, th.minOutageMinutes * 60_000).slice(0, 20)
    .map(({ outage, ...e }) => ({ ...e, href: (e.sid && serviceById(engine.cfg).get(e.sid)?.href) ?? null, open: feedTarget(engine, e.sid, outage == null) }));
  const att = round.close(events);
  for (const f of att.feed) if ('key' in f) f.open = noteTarget(engine, f);
  applyWorst(tiles, att);
  const all = [...tiles.values()];
  const widgets = widgetsOf(engine);
  const network = networkOf(widgets, settings.network, now, history);
  // a bucket is amber when a probe took over twice the service's own Slow limit (history of removed services: the global one)
  const slowLimit = new Map(engine.cfg.services.map((s) => [s.id, s.latencyWarnMs ?? th.latencyWarnMs]));
  const m = minute(mem, now);
  const strip = fleetOf((m.fleet ??= probeBuckets(now - BUCKETS * BUCKET_MS, BUCKET_MS)), (sid) => slowLimit.get(sid) ?? th.latencyWarnMs);
  for (const t of all) t.beats = strip.beats.get(t.id) ?? null;
  const buckets = strip.fleet;
  const ups = all.map((t) => t.uptime24).filter((x) => x != null);
  const fleetAvail = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  const jobs = jobList(engine, now);
  // the week behind the Backups strip: the backup jobs' checks per day, and what the backup services reported
  const since = now - DAYS * 24 * H;
  const backupHistory = (m.backupDays ??= {
    checks: probeDays(engine.cfg.services.filter((s) => s.heartbeat?.backup).map((s) => s.id), since, 24 * H),
    events: eventLevels(engine.cfg.services.filter(isBackupService).map((s) => s.id), since)
  });
  const { sheet: backups, panel: backupsPanel } = backupsOf(widgets.flatMap(({ s, w }) => (w.backups ? [{ id: s.id, name: s.name, backups: w.backups }] : [])), jobs, now, backupHistory, settings.thresholds.backupMaxAgeHours * H);
  const verdict = verdictOf({ tiles: all, jobs, backupRows: backups.rows.length, certWarnDays: th.certWarnDays }, att);
  const mostUsed = mostUsedRow(all, settings, now);

  return {
    generatedAt: now,
    demo: engine.cfg.demo,
    version: VERSION,
    configProblems: (engine.cfg.problems ?? []).length,
    title: settings.title,
    linkTarget: settings.linkTarget,
    deepLink: settings.deepLink,
    logo: assetUrl(settings.pwa.logo),
    logoDark: darkAssetUrl(settings.pwa, 'logo'),
    staleAfter: Math.max(settings.intervals.widgets, settings.intervals.probe) * 2.5 * 1000,
    verdict,
    lastChange: events[0]?.ts ?? null,
    jobs,
    backups,
    attention: att.items,
    needCount: att.needCount,
    feed: att.feed,
    fleet: buckets,
    fleetAvail,
    host,
    storage,
    drives,
    network,
    infrastructure: infrastructure({ host, drives, network }, { storage: disks.panel, backups: backupsPanel }),
    mostUsed,
    groups: groups.map((g) => {
      const ts = g.services.map((s) => (tiles.get(s.id) as Tile)); // every service got a tile above
      const known = ts.filter((t) => t.level !== 'unknown');
      return { name: g.name, summary: `${known.filter((t) => t.status !== 'Down').length} of ${known.length} up`, services: ts };
    }),
    bookmarks: bookmarks.map((b) => ({ ...b, ...themed(engine, b.name, b.icon, b.iconDark) }))
  };
}
