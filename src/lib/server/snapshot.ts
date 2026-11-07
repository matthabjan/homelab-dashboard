// Turns engine state + history into the JSON the browser renders.
import fs from 'node:fs';
import { resolveIcon, assetUrl } from './config.ts';
import { probeStats, uptimeSince, probeBuckets, series, recentEvents, openScores } from './db.ts';
import { fmtHours, fmtSize, plural } from './format.ts';
import { hostService, hostSource } from './local.ts';
import { kindOf, status as checkStatus } from './check.ts';
import { createAttention, type Raised } from './attention.ts';
import { infrastructure } from './infrastructure.ts';
import type { BackupStatus, ConfigProblem, Drive, HeartbeatState, Fact, Gauge, Job, Level, NetworkReading, Settings, Severity, Snapshot, Tile, Traffic, Trend } from '$lib/types';
import type { Engine } from './engine.ts';

const RANK: Record<Severity | Level, number> = { crit: 3, warn: 2, info: 1, ok: 0 };
// shown in the footer; package.json sits in the working directory in the image (/app) and in a checkout
const VERSION = (() => { try { return String(JSON.parse(fs.readFileSync('package.json', 'utf8')).version); } catch { return null; } })();
const H = 3600_000;
const MIN_SLOW_SAMPLES = 10; // ~5 min of probes before a service can be called slow

/** What the snapshot reads from the engine; the Engine itself satisfies it. */
export type SnapshotInput = Pick<Engine, 'cfg' | 'state' | 'autoIcons' | 'iconVariants' | 'shared' | 'temps' | 'local'>;
type ProbeSummary = { up24: number | null; p95: number | null; p95h: number | null; n1: number; up7: number | null };
/** What a builder carries from one snapshot to the next. */
type Memory = { minute: { ts: number; data: Map<string, unknown> }; attention: ReturnType<typeof createAttention> };

/**
 * A snapshot builder. It remembers when each alert first appeared (so attention shows "since" instead of
 * "last polled") and keeps history queries for a minute, so keep one per engine.
 */
export function createSnapshot(): (input: SnapshotInput, now: number) => Snapshot {
  const mem: Memory = { minute: { ts: 0, data: new Map() }, attention: createAttention() };
  return (input, now) => build(input, now, mem);
}

/**
 * `read()` once a minute per key: the snapshot is rebuilt after every round and heartbeat, and the history queries
 * behind it (probe statistics, the 24 h strips, the gauges' series) are most of its cost (the strip ~80 ms at 30
 * services). History moves on by a probe or two in that minute.
 */
function perMinute<T>(mem: Memory, now: number, key: string, read: () => T): T {
  if (now - mem.minute.ts > 60_000) mem.minute = { ts: now, data: new Map() };
  if (!mem.minute.data.has(key)) mem.minute.data.set(key, read());
  return mem.minute.data.get(key) as T;
}

function stats(mem: Memory, sid: string, now: number): ProbeSummary {
  return perMinute(mem, now, `stats ${sid}`, () => {
    const d = probeStats(sid, now - 24 * H);
    const h1 = probeStats(sid, now - H);
    return { up24: d.uptime, p95: d.p95, p95h: h1.p95, n1: h1.n, up7: uptimeSince(sid, now - 7 * 24 * H) };
  });
}

/** A metric's 24 h series in `points` buckets. */
const series24 = (mem: Memory, now: number, key: string, points: number) => perMinute(mem, now, `series ${key} ${points}`, () => series(key, now - 24 * H, now, points));

/** A metric's 24 h trend, or null while it has fewer than two samples (nothing to draw). */
const trend24 = (mem: Memory, now: number, key: string | undefined, points: number): Trend | null => {
  if (!key) return null;
  const s = series24(mem, now, key, points);
  return s.values.filter((v) => v != null).length > 1 ? s : null;
};

const level = (v: number | null | undefined, warn: number, crit: number): Level | 'none' => (v == null ? 'none' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok');

/** A heartbeat marked `backup: true`, with its service's name. */
export interface BackupBeat {
  name: string;
  hb: HeartbeatState | null;
}

/** Every PBS widget's backups as one: overdue counts added up, the oldest the oldest of them; undefined without any. */
function sumBackups(list: BackupStatus[]): BackupStatus | undefined {
  const known = list.filter((b) => b.known);
  if (!known.length) return undefined;
  const oldest = known.filter((b) => b.oldestAge != null).sort((a, b) => (b.oldestAge as number) - (a.oldestAge as number))[0];
  return { overdue: known.reduce((n, b) => n + b.overdue, 0), oldestAge: oldest?.oldestAge ?? null, oldestName: oldest?.oldestName ?? null, known: true };
}

/**
 * PBS backups plus heartbeats marked `backup: true` (restic, borg, Kopia …): overdue counts added up, the oldest age
 * the larger one, named after what it is; a heartbeat that never ran has no age yet.
 */
export function mergeBackups(pbs: BackupStatus | undefined, beats: BackupBeat[], now: number): BackupStatus | undefined {
  const known = beats.filter((b) => b.hb && b.hb.state !== 'pending');
  if (!known.length) return pbs;
  const ages = known.flatMap((b) => (b.hb?.lastOk != null ? [{ age: now - b.hb.lastOk, name: b.name }] : []));
  if (pbs?.oldestAge != null) ages.push({ age: pbs.oldestAge, name: pbs.oldestName ?? '' });
  const oldest = ages.reduce<{ age: number; name: string } | null>((o, a) => (!o || a.age > o.age ? a : o), null);
  return {
    overdue: (pbs?.overdue ?? 0) + known.filter((b) => b.hb?.state === 'down').length,
    oldestAge: oldest?.age ?? null,
    oldestName: oldest?.name || null,
    known: true
  };
}

/**
 * A drive's row in the Drives panel, and what is wrong with it: each problem is raised for the service that reported
 * the drive, as a predicate of the drive ("WD Red has 8% life left").
 */
function driveStatus(d: Drive, where: string, th: Settings['thresholds']) {
  /** severity, alert text, alert key */
  const problems: ['crit' | 'warn', string, string][] = [];
  if (d.health === 'failing') problems.push(['crit', 'is failing SMART', 'health']);
  if (d.health === 'warning') problems.push(['warn', 'has a past or minor SMART problem', 'health']);
  if (d.lifeLeft != null && d.lifeLeft <= th.driveLifeWarnPct) problems.push(['warn', `has ${d.lifeLeft}% life left`, 'life']);
  if (d.errors) problems.push(['warn', `has ${d.errors} media errors or bad sectors`, 'errors']);
  if (d.tempC != null && d.tempC >= th.driveTempWarnC) problems.push(['warn', `is at ${d.tempC} °C`, 'temp']);
  const level: Level = problems.some((p) => p[0] === 'crit') ? 'crit' : problems.length ? 'warn' : 'ok';
  const detail = [
    d.lifeLeft != null && `${d.lifeLeft}% life left`,
    d.tempC != null && `${d.tempC} °C`,
    d.hours != null && `${fmtHours(d.hours)} powered on`,
    d.written != null && `${fmtSize(d.written)} written`,
    d.errors ? `${d.errors} errors` : null
  ].filter(Boolean).join(' · ');
  const status = d.health === 'failing' ? 'failing' : level === 'warn' ? 'check' : d.health === 'unknown' ? '—' : 'ok';
  /** shown next to the model; power-on time and data written stay in `detail` (the tooltip) */
  const facts: Fact[] = [];
  if (d.tempC != null) facts.push({ k: '', v: `${d.tempC} °C`, level: d.tempC >= th.driveTempWarnC ? 'warn' : null });
  if (d.errors) facts.push({ k: 'errors', v: String(d.errors), level: 'warn' });
  const lifeLevel: Level = d.lifeLeft != null && d.lifeLeft <= th.driveLifeWarnPct ? 'warn' : 'ok';
  return {
    row: { name: d.model, group: where, meta: [d.kind, fmtSize(d.size), where].join(' · '), detail: detail || 'no SMART details', status, level, life: d.lifeLeft, lifeLevel, tempC: d.tempC, facts },
    problems
  };
}

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
type Th = Settings['thresholds'];
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
        stats: (w?.stats || []).slice(0, 3),
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

/** The System panel: the Proxmox node, or the machine the dashboard runs on, plus the kernel's temperatures. */
function hostPanel(engine: SnapshotInput, now: number, mem: Memory, round: Round): Snapshot['host'] {
  const { settings } = engine.cfg;
  const th = settings.thresholds;
  const hostSvc = hostSource(engine.cfg) === 'proxmox' ? hostService(engine.cfg) : undefined;
  const hw = hostSvc ? engine.state(hostSvc.id).widget?.host : engine.local;
  // 15-minute buckets: fine enough to scrub through, coarse enough to stay smooth
  const hist = (key: string | undefined) => {
    const t = trend24(mem, now, key, 96);
    return t ? { series: t.values, from: t.from } : { series: null };
  };
  let host = null;
  if (hw || engine.temps) {
    const temps = engine.temps;
    const gauges: Gauge[] = [];
    if (hw) {
      gauges.push({ key: 'cpu', label: 'CPU', val: hw.cpu == null ? '—' : Math.round(hw.cpu), unit: '%', pct: hw.cpu, level: level(hw.cpu, 75, 90), sub: `${hw.cpus} threads`, ...hist('host.cpu'), max: 100, warn: 75 });
      // a percentage like the other gauges and its history; the amounts are the detail
      gauges.push({ key: 'mem', label: 'Memory', val: Math.round(hw.memPct), unit: '%', pct: hw.memPct, level: level(hw.memPct, 80, 92), sub: `${(hw.mem / 1024 ** 3).toFixed(1)} of ${Math.round(hw.maxmem / 1024 ** 3)} GiB`, ...hist('host.mem'), max: 100, warn: 80 });
      gauges.push({ key: 'disk', label: 'Disk', val: hw.disk.pct == null ? '—' : Math.round(hw.disk.pct), unit: '%', pct: hw.disk.pct, level: level(hw.disk.pct, th.storageAmberPct, th.storageWarnPct), sub: hw.disk.name, ...hist(hostSvc ? hw.disk.metric : 'host.disk'), max: 100, warn: th.storageAmberPct });
      // a Proxmox disk that is also a storage row (same metric) is raised by the row; one host.storages leaves out, or
      // the root file system, only by the gauge. The local host has no other place for it
      if (hw.disk.pct != null && hw.disk.pct >= th.storageWarnPct) {
        const pct = Math.round(hw.disk.pct);
        if (!hostSvc) round.raise({ sev: 'warn', source: 'host', key: 'local-disk', title: `Disk ${hw.disk.name} is ${pct}% full`, detail: `${hw.node} · ${hw.disk.sub}` });
        else if (!engine.state(hostSvc.id).widget?.storage?.some((r) => r.metric === hw.disk.metric)) {
          round.raise({ sev: 'warn', service: hostSvc, key: `storage-${hw.disk.name}`, title: `${hw.disk.name} is ${pct}% full`, detail: hw.disk.sub });
        }
      }
    }
    if (temps?.cpu != null) {
      const span = th.tempWarnC + 15 - th.tempMinC;
      const tp = Math.max(0, Math.min(100, ((temps.cpu - th.tempMinC) / span) * 100));
      // the chart's dashed line shows the limit, so the corner gives the day's peak (15-minute averages); without
      // history yet there is no chart, and the corner names the limit instead
      const tempHist = hist('host.temp');
      const peak = Math.max(...(tempHist.series ?? []).filter((v) => v != null));
      gauges.push({ key: 'temp', label: 'CPU temp', val: Math.round(temps.cpu), unit: '°C', pct: tp, level: level(temps.cpu, th.tempWarnC, th.tempWarnC + 10), sub: tempHist.series ? `24 h peak ${Math.round(peak)} °C` : `warn ${th.tempWarnC} °C`, ...tempHist, max: null, warn: th.tempWarnC });
      // the kernel's sensors are the Proxmox node's (the dashboard shares its kernel), so its tile carries them
      const whose = hostSvc ? { service: hostSvc } : { source: 'host' };
      if (temps.cpu >= th.tempWarnC) round.raise({ ...whose, key: 'cpu-temp', sev: temps.cpu >= th.tempWarnC + 10 ? 'crit' : 'warn', title: `CPU at ${Math.round(temps.cpu)} °C`, detail: `limit ${th.tempWarnC} °C` });
      temps.nvme.forEach((n, i) => { if (n >= th.driveTempWarnC) round.raise({ ...whose, key: `nvme-temp-${i}`, sev: 'warn', title: `NVMe at ${Math.round(n)} °C`, detail: 'drive is running hot' }); });
    }
    host = {
      name: settings.host.name || (hw?.node ?? 'host'),
      href: hostSvc?.href ?? null,
      facts: [
        ...(hw?.uptime ? [{ label: 'Uptime', value: hw.uptime }] : []),
        ...(hw?.guestsTotal != null ? [{ label: 'Guests', value: `${hw.guestsRunning} of ${hw.guestsTotal} running` }] : [])
      ],
      gauges
    };
  }
  return host;
}

/** Storage rows from every widget that reports them; a row over `storageWarnPct` is raised for its service. */
function storagePanel(engine: SnapshotInput, th: Th, round: Round, now: number, mem: Memory): Snapshot['storage'] {
  const storage: Snapshot['storage'] = [];
  for (const s of engine.cfg.services) {
    const w = engine.state(s.id).widget;
    // sources follow services.yaml; within one, by name: APIs (cluster/resources) don't keep a stable order,
    // and an offline row keeps its place instead of jumping to the end
    for (const x of [...(w?.storage || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      // unavailable, detached or of unknown size: a grey bar (last known fill, if any), the widget raises any alert itself
      if (x.offline || x.pct == null) { storage.push({ name: x.name, group: s.name, pct: x.pct ?? null, level: 'off', sub: x.sub, warn: th.storageAmberPct, trend: trend24(mem, now, x.metric, 48) }); continue; }
      const lv: Level = x.pct >= th.storageWarnPct ? 'crit' : x.pct >= th.storageAmberPct ? 'warn' : 'ok';
      storage.push({ name: x.name, group: s.name, pct: x.pct, level: lv, sub: x.sub, warn: th.storageAmberPct, trend: trend24(mem, now, x.metric, 48) });
      if (x.pct >= th.storageWarnPct) round.raise({ sev: 'warn', service: s, key: `storage-${x.name}`, title: `${x.name} is ${Math.round(x.pct)}% full`, detail: x.sub });
    }
  }
  return storage;
}

/** The Drives panel: one row per disk (a disk passed through whole is listed once), its problems raised. */
function drivesPanel(engine: SnapshotInput, th: Th, round: Round): Snapshot['drives'] {
  const drives: Snapshot['drives'] = [];
  const seenSerials = new Set();
  for (const s of engine.cfg.services) {
    const w = engine.state(s.id).widget;
    for (const d of [...(w?.drives || [])].sort((a, b) => a.model.localeCompare(b.model, undefined, { numeric: true }))) {
      // a disk passed through whole is reported by the host and by the VM
      if (d.serial && seenSerials.has(d.serial)) continue;
      if (d.serial) seenSerials.add(d.serial);
      const { row, problems } = driveStatus(d, d.where ?? s.name, th);
      for (const [sev, text, key] of problems) round.raise({ sev, service: s, key: `drive-${d.serial ?? d.model}-${key}`, title: `${d.model} ${text}`, detail: row.meta });
      drives.push(row);
    }
  }
  return drives;
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

/** WAN and LAN traffic with 24 h series, and DNS statistics, from the widgets settings.network picks. */
function networkPanel(engine: SnapshotInput, widgets: ReturnType<typeof widgetsOf>, now: number, mem: Memory): Snapshot['network'] {
  const { settings } = engine.cfg;
  let network: Snapshot['network'] = null;
  const netPick = settings.network?.service;
  const net = netPick
    ? widgets.find((x) => x.s.name === netPick && x.w.network)
    : widgets.find((x) => x.w.network && !x.w.network.fallback) || widgets.find((x) => x.w.network);
  const dnsPick = settings.network?.dns;
  const dns = widgets.find((x) => x.w.dns && (!dnsPick || x.s.name === dnsPick));
  const lan = widgets.find((x) => x.w.lan);
  /**
   * Rates plus 24 h series for one reading, from the metrics `<key>.down` / `<key>.up`.
   */
  const traffic = (key: string, reading: NetworkReading, href: string | null): Traffic => {
    const sDown = series24(mem, now, `${key}.down`, 72);
    const sUp = series24(mem, now, `${key}.up`, 72);
    return { source: reading.source, href, down: reading.down, up: reading.up, seriesDown: sDown.values, seriesUp: sUp.values, spanH: Math.max(1, Math.round((now - sDown.from) / H)), from: sDown.from };
  };
  if (net || dns || lan?.w.lan) {
    const nw = net?.w.network;
    network = {
      ...(nw ? traffic(nw.fallback ? 'fritz' : 'net', nw, net.s.href) : { source: null, href: null, down: null, up: null, seriesDown: null, seriesUp: null, spanH: null, from: null }),
      lan: lan?.w.lan ? traffic('lan', lan.w.lan, lan.s.href) : null,
      dns: dns?.w.dns ? { ...dns.w.dns, href: dns.s.href, name: dns.s.name } : null
    };
  }
  return network;
}

/** The fleet availability strip (48 × 30 min), and the same buckets per service as each tile's `beats`. */
function fleetStrip(engine: SnapshotInput, tiles: Map<string, Tile>, now: number, mem: Memory): Snapshot['fleet'] {
  const th = engine.cfg.settings.thresholds;
  const B = 30 * 60_000;
  const start = now - 48 * B;
  const buckets: Snapshot['fleet'] = Array.from({ length: 48 }, () => 'none');
  // a bucket is amber when a probe took over twice the service's own Slow limit (history of removed services: the global one)
  const slowLimit = new Map(engine.cfg.services.map((s) => [s.id, s.latencyWarnMs ?? th.latencyWarnMs]));
  // bucket indexes count from the `start` of the query, which may be up to a minute older than this one
  for (const r of perMinute(mem, now, 'fleet', () => probeBuckets(start, B))) {
    const i = Math.max(0, Math.min(47, Math.floor(Number(r.b))));
    const ratio = r.fails / r.n;
    const slowMs = slowLimit.get(String(r.sid)) ?? th.latencyWarnMs;
    const lv: Level = ratio >= 0.5 ? 'crit' : ratio >= 0.1 || (r.maxms ?? 0) > slowMs * 2 ? 'warn' : 'ok';
    if (buckets[i] === 'none' || RANK[lv] > RANK[buckets[i]]) buckets[i] = lv;
    // the same buckets per service, for the strip on each tile
    const t = tiles.get(String(r.sid));
    if (t) {
      t.beats ??= Array.from({ length: 48 }, () => 'none');
      t.beats[i] = lv;
    }
  }
  return buckets;
}

/** Heartbeat services with their schedule: when each last ran and when the next run is due. */
function jobList(engine: SnapshotInput): Job[] {
  return engine.cfg.services.flatMap((s) => {
    const hb = s.heartbeat;
    if (!hb) return [];
    const st = engine.state(s.id).heartbeat;
    const last = st?.lastOk ?? null;
    return [{
      id: s.id, name: s.name, group: s.group, href: s.href ?? null, description: s.description ?? '',
      every: hb.every, grace: hb.grace, lastOk: last, lastFail: st?.lastFail ?? null,
      due: (last ?? st?.since ?? Date.now()) + hb.every,
      state: st?.state ?? 'pending', failed: st?.failed ?? false, backup: hb.backup
    }];
  });
}

/**
 * The hero's sentence. Healthy: how many services are up, jobs counted apart ("All 11 services up", "5 backup jobs on
 * schedule"). Otherwise: the top attention item, its detail, and the way to the service.
 */
function verdictOf(engine: SnapshotInput, all: Tile[], jobs: Job[], backups: BackupStatus | null, att: ReturnType<Round['close']>): Snapshot['verdict'] {
  const th = engine.cfg.settings.thresholds;
  const probed = all.filter((t) => t.level !== 'unknown');
  const services = probed.filter((t) => t.check !== 'heartbeat');
  const servicesUp = services.filter((t) => t.status !== 'Down').length;
  const certWarn = all.filter((t) => t.cert && t.cert.days < th.certWarnDays).length;
  const onSchedule = jobs.filter((j) => j.state !== 'down').length;
  const jobWord = jobs.every((j) => j.backup) ? 'backup job' : 'job';

  const subParts: string[] = [];
  let title = att.headline.title.replace(/\.$/, '');
  let action: Snapshot['verdict']['action'] = null;
  if (att.needCount) {
    const top = att.items[0];
    if (top.detail) subParts.push(top.detail);
    subParts.push(`${servicesUp} of ${services.length} services up`);
    if (top.href) action = { label: `Open ${top.service ?? 'it'}`, href: top.href };
  } else {
    if (services.length === 1 && servicesUp === 1) title = `${services[0].name} is up`;
    else if (services.length) title = servicesUp === services.length ? `All ${services.length} services up` : `${servicesUp} of ${services.length} services up`;
    if (jobs.length) subParts.push(onSchedule === jobs.length ? `${plural(jobs.length, jobWord)} on schedule` : `${onSchedule} of ${plural(jobs.length, jobWord)} on schedule`);
    if (backups?.known && !jobs.length) subParts.push(backups.overdue ? `${plural(backups.overdue, 'backup')} overdue` : 'backups current');
    if (certWarn) subParts.push(`${plural(certWarn, 'certificate')} expiring`);
  }
  return { ...att.headline, title, sub: subParts.join(' · '), action };
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
  const host = hostPanel(engine, now, mem, round);
  const storage = storagePanel(engine, th, round, now, mem);
  const drives = drivesPanel(engine, th, round);

  const events = recentEvents(now - 24 * H, 20).map((e) => ({ ...e, href: (e.sid && engine.cfg.services.find((s) => s.id === e.sid)?.href) ?? null }));
  const att = round.close(events);
  applyWorst(tiles, att);
  const all = [...tiles.values()];
  const widgets = widgetsOf(engine);
  const network = networkPanel(engine, widgets, now, mem);
  const buckets = fleetStrip(engine, tiles, now, mem);
  const ups = all.map((t) => t.uptime24).filter((x) => x != null);
  const fleetAvail = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  const jobs = jobList(engine);
  // every PBS widget, and the heartbeats marked `backup: true`
  const pbs = sumBackups(widgets.flatMap(({ w }) => (w.backups ? [w.backups] : [])));
  const backups = mergeBackups(pbs, engine.cfg.services.flatMap((s) => (s.heartbeat?.backup ? [{ name: s.name, hb: engine.state(s.id).heartbeat ?? null }] : [])), now) ?? null;
  const verdict = verdictOf(engine, all, jobs, backups, att);
  const mostUsed = mostUsedRow(all, settings, now);

  const parts = { host, storage, drives, network, jobs, backups };
  return {
    generatedAt: now,
    demo: engine.cfg.demo,
    version: VERSION,
    configProblems: (engine.cfg.problems ?? []).length,
    title: settings.title,
    linkTarget: settings.linkTarget,
    deepLink: settings.deepLink,
    logo: assetUrl(settings.pwa.logo),
    staleAfter: Math.max(settings.intervals.widgets, settings.intervals.probe) * 2.5 * 1000,
    verdict,
    lastChange: events[0]?.ts ?? null,
    jobs,
    guestBackups: widgets.flatMap(({ s, w }) => {
      const b = w.backups;
      if (!b?.known) return [];
      const hostOverdue = b.hostOverdue ?? 0;
      return [{ id: s.id, name: s.name, stores: b.stores ?? [], guests: b.guests ?? 0, last: b.last ?? null, overdue: b.overdue - hostOverdue, hosts: b.hosts ?? [], hostLast: b.hostLast ?? null, hostOverdue }];
    }),
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
    infrastructure: infrastructure(parts, pbs?.overdue ?? 0, now),
    mostUsed,
    groups: groups.map((g) => {
      const ts = g.services.map((s) => (tiles.get(s.id) as Tile)); // every service got a tile above
      const known = ts.filter((t) => t.level !== 'unknown');
      return { name: g.name, summary: `${known.filter((t) => t.status !== 'Down').length} of ${known.length} up`, services: ts };
    }),
    bookmarks: bookmarks.map((b) => ({ ...b, ...themed(engine, b.name, b.icon, b.iconDark) }))
  };
}
