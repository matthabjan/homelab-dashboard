// Turns engine state + history into the JSON the browser renders.
import fs from 'node:fs';
import { resolveIcon, assetUrl } from './config.ts';
import { probeStats, uptimeSince, probeBuckets, series, recentEvents, openScores } from './db.ts';
import { fmtDuration as fmtAge, fmtHours, fmtSize } from './format.ts';
import { DEMO } from './demo.ts';
import { hostService, hostSource } from './local.ts';
import { kindOf, status as checkStatus } from './check.ts';
import { createAttention, type Raised } from './attention.ts';
import type { BackupStatus, ConfigProblem, ContainerCounts, Drive, HeartbeatState, Fact, Gauge, Level, NetworkReading, Settings, Severity, Snapshot, Tile, Traffic } from '$lib/types';
import type { Engine } from './engine.ts';

const RANK: Record<Severity | Level, number> = { crit: 3, warn: 2, info: 1, ok: 0 };
// shown in the footer; package.json sits in the working directory in the image (/app) and in a checkout
const VERSION = (() => { try { return String(JSON.parse(fs.readFileSync('package.json', 'utf8')).version); } catch { return null; } })();
const H = 3600_000;
const MIN_SLOW_SAMPLES = 10; // ~5 min of probes before a service can be called slow

/** What the snapshot reads from the engine; the Engine itself satisfies it. */
export type SnapshotInput = Pick<Engine, 'cfg' | 'state' | 'autoIcons' | 'shared' | 'temps' | 'local'>;
type ProbeSummary = { up24: number | null; p95: number | null; p95h: number | null; n1: number; up7: number | null };
/** What a builder carries from one snapshot to the next. */
type Memory = { stats: { ts: number; data: Map<string, ProbeSummary> }; attention: ReturnType<typeof createAttention> };

/**
 * A snapshot builder. It remembers when each alert first appeared (so attention shows "since" instead of
 * "last polled") and caches probe statistics for a minute, so keep one per engine.
 */
export function createSnapshot(): (input: SnapshotInput, now: number) => Snapshot {
  const mem: Memory = { stats: { ts: 0, data: new Map() }, attention: createAttention() };
  return (input, now) => build(input, now, mem);
}

function stats(mem: Memory, sid: string, now: number): ProbeSummary {
  if (now - mem.stats.ts > 60_000) mem.stats = { ts: now, data: new Map() };
  let s = mem.stats.data.get(sid);
  if (!s) {
    const d = probeStats(sid, now - 24 * H);
    const h1 = probeStats(sid, now - H);
    s = { up24: d.uptime, p95: d.p95, p95h: h1.p95, n1: h1.n, up7: uptimeSince(sid, now - 7 * 24 * H) };
    mem.stats.data.set(sid, s);
  }
  return s;
}

const level = (v: number | null | undefined, warn: number, crit: number): Level | 'none' => (v == null ? 'none' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok');

/**
 * PBS backups plus heartbeats marked `backup: true` (restic, borg, Kopia …): overdue counts added up, the oldest age
 * the larger one; a heartbeat that never ran has no age yet.
 */
export function mergeBackups(pbs: BackupStatus | undefined, beats: (HeartbeatState | null)[], now: number): BackupStatus | undefined {
  const known = beats.filter((b) => b && b.state !== 'pending');
  if (!known.length) return pbs;
  const ages = known.flatMap((b) => (b?.lastOk != null ? [now - b.lastOk] : []));
  const oldest = [pbs?.oldestAge, ...ages].filter((a) => a != null);
  return {
    overdue: (pbs?.overdue ?? 0) + known.filter((b) => b?.state === 'down').length,
    oldestAge: oldest.length ? Math.max(...(oldest as number[])) : null,
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
    row: { name: d.model, meta: [d.kind, fmtSize(d.size), where].join(' · '), detail: detail || 'no SMART details', status, level, life: d.lifeLeft, lifeLevel, facts },
    problems
  };
}

function build(engine: SnapshotInput, now: number, mem: Memory): Snapshot {
  const { settings, groups, bookmarks } = engine.cfg;
  const th = settings.thresholds;
  // everything is raised first: a tile is as bad as the worst alert raised for its service, wherever it came from
  const round = mem.attention.begin(now);
  const tiles: Map<string, Tile> = new Map();

  // a config file with an error: keeping its last version is a warning, losing its content is critical
  const shown: Record<string, string> = { last: 'showing the last working version', none: 'nothing loaded from it', null: 'the rest of the file is loaded' };
  // one alert per file, however many problems it has: /config lists each of them
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

  for (const g of groups) {
    for (const s of g.services) {
      const st = engine.state(s.id);
      const c = st.check;
      const w = st.widget;
      const ps = kindOf(s) ? stats(mem, s.id, now) : null; // container and heartbeat states are recorded like probes
      const host = (() => { try { return new URL(s.href || s.probe || '').host; } catch { return ''; } })();
      const cs = checkStatus(s, st, now);
      let lvl: Tile['level'] = cs ? cs.lvl : w ? 'ok' : 'unknown';
      let status = cs ? cs.status : w ? 'Up' : 'Checking';
      let line = w?.line || s.description || '';
      let lineLevel: Tile['lineLevel'] = null;
      if (cs?.line) { line = cs.line; lineLevel = cs.lineLevel !== undefined ? cs.lineLevel : lvl === 'unknown' ? 'muted' : lvl; }
      const auto = s.icon ? null : engine.autoIcons.get(s.id);
      const iconDark = s.iconDark ?? auto?.iconDark;

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
        icon: resolveIcon(s.icon ?? auto?.icon, s.name),
        iconDark: iconDark ? resolveIcon(iconDark, s.name) : null,
        level: lvl,
        status,
        line,
        lineLevel,
        stats: (w?.stats || []).slice(0, 3),
        uptime24: ps?.up24 ?? null,
        uptime7: ps?.up7 ?? null,
        p95: ps?.p95 ?? null,
        cert,
        beats: null
      });
    }
  }

  // ---- host vitals: the Proxmox node, or the machine the dashboard runs on ----
  const hostSvc = hostSource(engine.cfg) === 'proxmox' ? hostService(engine.cfg) : undefined;
  const hw = hostSvc ? engine.state(hostSvc.id).widget?.host : engine.local;
  const since24 = now - 24 * H;
  const spark = (key: string) => series(key, since24, now, 48).values;
  let host = null;
  if (hw || engine.temps) {
    const temps = engine.temps;
    const gauges: Gauge[] = [];
    if (hw) {
      gauges.push({ key: 'cpu', label: 'CPU', val: hw.cpu == null ? '—' : Math.round(hw.cpu), unit: '%', pct: hw.cpu, level: level(hw.cpu, 75, 90), sub: `${hw.cpus} threads`, series: spark('host.cpu'), max: 100 });
      gauges.push({ key: 'mem', label: 'Memory', val: (hw.mem / 1024 ** 3).toFixed(1), unit: `of ${Math.round(hw.maxmem / 1024 ** 3)} GiB`, pct: hw.memPct, level: level(hw.memPct, 80, 92), sub: `${Math.round(hw.memPct)}% used`, series: spark('host.mem'), max: 100 });
      gauges.push({ key: 'disk', label: 'Disk', val: hw.disk.pct == null ? '—' : Math.round(hw.disk.pct), unit: '%', pct: hw.disk.pct, level: level(hw.disk.pct, th.storageAmberPct, th.storageWarnPct), sub: hw.disk.name, series: null });
      // a Proxmox node's disk is also a storage row, which raises this itself; the local host has no other place for it
      if (!hostSvc && hw.disk.pct != null && hw.disk.pct >= th.storageWarnPct) {
        round.raise({ sev: 'warn', source: 'host', key: 'local-disk', title: `Disk ${hw.disk.name} is ${Math.round(hw.disk.pct)}% full`, detail: `${hw.node} · ${hw.disk.sub}` });
      }
    }
    if (temps?.cpu != null) {
      const span = th.tempWarnC + 15 - th.tempMinC;
      const tp = Math.max(0, Math.min(100, ((temps.cpu - th.tempMinC) / span) * 100));
      gauges.push({ key: 'temp', label: 'CPU temp', val: Math.round(temps.cpu), unit: '°C', pct: tp, level: level(temps.cpu, th.tempWarnC, th.tempWarnC + 10), sub: `warn at ${th.tempWarnC} °C`, series: spark('host.temp'), max: null });
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

  // ---- storage ----
  const storage: Snapshot['storage'] = [];
  for (const s of engine.cfg.services) {
    const w = engine.state(s.id).widget;
    // sources follow services.yaml; within one, by name: APIs (cluster/resources) don't keep a stable order,
    // and an offline row keeps its place instead of jumping to the end
    for (const x of [...(w?.storage || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
      // unavailable, detached or of unknown size: a grey bar (last known fill, if any), the widget raises any alert itself
      if (x.offline || x.pct == null) { storage.push({ name: x.name, pct: x.pct ?? null, level: 'off', sub: x.sub }); continue; }
      const lv: Level = x.pct >= th.storageWarnPct ? 'crit' : x.pct >= th.storageAmberPct ? 'warn' : 'ok';
      storage.push({ name: x.name, pct: x.pct, level: lv, sub: x.sub });
      if (x.pct >= th.storageWarnPct) round.raise({ sev: 'warn', service: s, key: `storage-${x.name}`, title: `${x.name} is ${Math.round(x.pct)}% full`, detail: x.sub });
    }
  }

  // ---- drives ----
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

  // ---- attention closed: each tile takes its worst alert when that is worse than its check says ----
  const events = recentEvents(now - 24 * H, 5).map((e) => ({ ...e, href: (e.sid && engine.cfg.services.find((s) => s.id === e.sid)?.href) ?? null }));
  const att = round.close(events);
  for (const t of tiles.values()) {
    const top = t.level === 'unknown' ? null : att.worst(t.id);
    if (top && RANK[top.sev] > RANK[t.level as Level]) {
      t.level = top.sev;
      t.line = top.detail ? `${top.title} · ${top.detail}` : top.title;
      t.lineLevel = top.sev;
    }
    t.line ||= t.level === 'ok' ? 'Online' : '';
  }
  const all = [...tiles.values()];
  const probed = all.filter((t) => t.level !== 'unknown');
  const up = probed.filter((t) => t.status !== 'Down').length;

  // ---- network ----
  let network: Snapshot['network'] = null;
  const widgets = engine.cfg.services.flatMap((s) => {
    const w = engine.state(s.id).widget;
    return w ? [{ s, w }] : [];
  });
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
    const sDown = series(`${key}.down`, since24, now, 72);
    const sUp = series(`${key}.up`, since24, now, 72);
    return { source: reading.source, href, down: reading.down, up: reading.up, seriesDown: sDown.values, seriesUp: sUp.values, spanH: Math.max(1, Math.round((now - sDown.from) / H)) };
  };
  if (net || dns || lan?.w.lan) {
    const nw = net?.w.network;
    network = {
      ...(nw ? traffic(nw.fallback ? 'fritz' : 'net', nw, net.s.href) : { source: null, href: null, down: null, up: null, seriesDown: null, seriesUp: null, spanH: null }),
      lan: lan?.w.lan ? traffic('lan', lan.w.lan, lan.s.href) : null,
      dns: dns?.w.dns ? { ...dns.w.dns, href: dns.s.href, name: dns.s.name } : null
    };
  }

  // ---- fleet availability strip (48 × 30 min) ----
  const B = 30 * 60_000;
  const start = now - 48 * B;
  const buckets: Snapshot['fleet'] = Array.from({ length: 48 }, () => 'none');
  for (const r of probeBuckets(start, B)) {
    const i = Math.max(0, Math.min(47, Math.floor(Number(r.b))));
    const ratio = r.fails / r.n;
    const lv: Level = ratio >= 0.5 ? 'crit' : ratio >= 0.1 || (r.maxms ?? 0) > th.latencyWarnMs * 2 ? 'warn' : 'ok';
    if (buckets[i] === 'none' || RANK[lv] > RANK[buckets[i]]) buckets[i] = lv;
    // the same buckets per service, for the strip on each tile
    const t = tiles.get(String(r.sid));
    if (t) {
      t.beats ??= Array.from({ length: 48 }, () => 'none');
      t.beats[i] = lv;
    }
  }
  const ups = all.map((t) => t.uptime24).filter((x) => x != null);
  const fleetAvail = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;

  // ---- verdict: the headline is attention's, the line under it this module's ----
  const backups = mergeBackups(widgets.find((x) => x.w.backups)?.w.backups, engine.cfg.services.flatMap((s) => (s.heartbeat?.backup ? [engine.state(s.id).heartbeat ?? null] : [])), now);
  const certWarn = all.filter((t) => t.cert && t.cert.days < th.certWarnDays).length;
  const subParts = [`${up} of ${probed.length} services up`];
  if (backups?.known) subParts.push(backups.overdue ? `${backups.overdue} backup${backups.overdue > 1 ? 's' : ''} overdue` : 'backups current');
  subParts.push(certWarn ? `${certWarn} certificate${certWarn > 1 ? 's' : ''} expiring` : 'no certs expiring soon');
  const verdict: Snapshot['verdict'] = { ...att.headline, sub: subParts.join(' · ') };

  // summed over Docker engines; a host seen by both Portainer and a docker widget is one entry
  const containers = Object.values(engine.shared.containers ?? {}).reduce(
    (a, c) => ({ running: a.running + c.running, total: a.total + c.total, failed: a.failed + c.failed, unhealthy: a.unhealthy + c.unhealthy }),
    ({ running: 0, total: 0, failed: 0, unhealthy: 0 } as ContainerCounts)
  );
  const nextCert = all.map((t) => t.cert).filter((c) => c !== null).filter((c) => !c.selfSigned).sort((a, b) => a.days - b.days)[0];
  const facts = ([
    { k: 'services up', v: `${up} / ${probed.length}`, level: up < probed.length ? 'crit' : null },
    containers.total > 0 && { k: 'containers up', v: `${containers.running} / ${containers.total}`, level: containers.failed ? 'warn' : null },
    backups?.oldestAge != null && { k: 'oldest backup', v: fmtAge(backups.oldestAge), level: backups.overdue ? 'warn' : null },
    nextCert && { k: 'next cert', v: `${nextCert.days} d`, level: nextCert.days < th.certWarnDays ? 'warn' : null }
  ] as (Fact | false | undefined)[]).filter((f): f is Fact => !!f);


  const scores = openScores(now, settings.mostUsed.halfLifeDays);
  const mostUsed = all
    .filter((t) => t.href && scores[t.id] > 0)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => scores[b.t.id] - scores[a.t.id] || a.i - b.i)
    .slice(0, Math.max(0, settings.mostUsed.count))
    .map((x) => x.t);

  return {
    generatedAt: now,
    demo: DEMO,
    version: VERSION,
    configProblems: (engine.cfg.problems ?? []).length,
    title: settings.title,
    linkTarget: settings.linkTarget,
    deepLink: settings.deepLink,
    logo: assetUrl(settings.pwa.logo),
    staleAfter: Math.max(settings.intervals.widgets, settings.intervals.probe) * 2.5 * 1000,
    verdict,
    facts,
    attention: att.items,
    needCount: att.needCount,
    feed: att.feed,
    fleet: buckets,
    fleetAvail,
    host,
    storage,
    drives,
    network,
    mostUsed,
    groups: groups.map((g) => {
      const ts = g.services.map((s) => (tiles.get(s.id) as Tile)); // every service got a tile above
      const known = ts.filter((t) => t.level !== 'unknown');
      return { name: g.name, summary: `${known.filter((t) => t.status !== 'Down').length} / ${known.length} up`, services: ts };
    }),
    bookmarks: bookmarks.map((b) => ({ ...b, icon: resolveIcon(b.icon, b.name), iconDark: b.iconDark ? resolveIcon(b.iconDark, b.name) : null }))
  };
}
