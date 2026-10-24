// Turns engine state + history into the JSON the browser renders.
import { resolveIcon, assetUrl } from './config.js';
import { probeStats, uptimeSince, probeBuckets, series, recentEvents, openCounts } from './db.js';
import { fmtPair, fmtDuration as fmtAge } from './format.js';
import { DEMO } from './demo.js';
/** @import { AttentionItem, Fact, Gauge, Level, Snapshot, Tile } from '$lib/types' */
/** @import { Engine } from './engine.js' */

const RANK = { crit: 3, warn: 2, info: 1, ok: 0 };
const H = 3600_000;
const MIN_SLOW_SAMPLES = 10; // ~5 min of probes before a service can be called slow

let statCache = { ts: 0, data: new Map() };
function stats(sid, now) {
  if (now - statCache.ts > 60_000) statCache = { ts: now, data: new Map() };
  if (!statCache.data.has(sid)) {
    const d = probeStats(sid, now - 24 * H);
    const h1 = probeStats(sid, now - H);
    statCache.data.set(sid, { up24: d.uptime, p95: d.p95, p95h: h1.p95, n1: h1.n, up7: uptimeSince(sid, now - 7 * 24 * H) });
  }
  return statCache.data.get(sid);
}

// remembers when each alert first appeared, so the feed shows "since" instead of "last polled"
const firstSeen = new Map();

/** @returns {Level | 'none'} */
const level = (v, warn, crit) => (v == null ? 'none' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok');

/**
 * Status of a label-discovered container without a siteMonitor. The Portainer widget raises its alerts.
 * @returns {{ lvl: Level, status: string, line: string | null }}
 */
function containerStatus({ state, health, exitCode }) {
  if (state === 'running' && health === 'unhealthy') return { lvl: 'warn', status: 'Unhealthy', line: 'Container unhealthy' };
  if (state === 'running') return { lvl: 'ok', status: 'Up', line: null };
  if (state === 'restarting') return { lvl: 'crit', status: 'Down', line: 'Container restarting' };
  return { lvl: 'crit', status: 'Down', line: `Container ${state}${exitCode ? ` · exit ${exitCode}` : ''}` };
}

/**
 * @param {Engine} engine
 * @returns {Snapshot}
 */
export function buildSnapshot(engine) {
  const { settings, groups, bookmarks } = engine.cfg;
  const th = settings.thresholds;
  const now = Date.now();
  /** @type {AttentionItem[]} */
  const attention = [];
  const opens = openCounts();
  /** @type {Map<string, Tile>} */
  const tiles = new Map();

  for (const g of groups) {
    for (const s of g.services) {
      const st = engine.state(s.id);
      const p = st.probe;
      const w = st.widget;
      const ps = s.probe ? stats(s.id, now) : null;
      const host = (() => { try { return new URL(s.href || s.probe).host; } catch { return ''; } })();
      /** @type {Tile['level']} */
      let lvl = s.probe ? (p.checked ? 'ok' : 'unknown') : w ? 'ok' : 'unknown';
      let status = lvl === 'ok' ? 'Up' : 'Checking';
      let line = w?.line || s.description || '';
      /** @type {Tile['lineLevel']} */
      let lineLevel = null;
      const ct = !s.probe && s.container ? containerStatus(s.container) : null;
      if (ct) {
        ({ lvl, status } = ct);
        if (ct.line) { line = ct.line; lineLevel = lvl; }
      }

      const push = (a) => attention.push({ ...a, sid: s.id, service: s.name, href: s.href, ts: a.ts ?? w?.ts ?? now });

      const slowMs = s.latencyWarnMs ?? th.latencyWarnMs;
      if (p.down) {
        lvl = 'crit';
        status = 'Down';
        line = `Down since ${new Date(p.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${p.reason}`;
        lineLevel = 'crit';
        push({ sev: 'crit', title: `${s.name} is down`, detail: `${p.reason} · since ${new Date(p.since).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, ts: p.since });
      } else if (ps?.p95h != null && ps.n1 >= MIN_SLOW_SAMPLES && ps.p95h > slowMs) {
        lvl = 'warn';
        status = 'Slow';
        push({ sev: 'warn', title: `${s.name} is slow`, detail: `p95 ${Math.round(ps.p95h)} ms over the last hour · limit ${slowMs} ms` });
        if (!w) { line = `Slow · p95 ${Math.round(ps.p95h)} ms`; lineLevel = 'warn'; }
      }

      let cert = null;
      if (st.cert) {
        const days = Math.floor((st.cert.validTo - now) / 86_400_000);
        cert = { days, selfSigned: st.cert.selfSigned };
        if (days < th.certWarnDays) {
          push({ sev: days < 3 ? 'crit' : 'warn', title: days < 0 ? 'Certificate expired' : `Certificate expires in ${days} d`, detail: host });
          if (lvl === 'ok') lvl = 'warn';
          if (!lineLevel) { line = days < 0 ? 'Certificate expired' : `Certificate expires in ${days} d`; lineLevel = 'warn'; }
        }
      }

      if (w) {
        for (const a of w.alerts || []) {
          push(a);
          if (RANK[a.sev] > RANK[lvl === 'unknown' ? 'ok' : lvl] && a.sev !== 'info') {
            lvl = a.sev;
            if (!p.down) { line = a.detail ? `${a.title} · ${a.detail}` : a.title; lineLevel = a.sev; }
          }
        }
        if (!w.ok) {
          push({ sev: 'info', title: `${s.name}: stats unavailable`, detail: w.error });
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
        icon: resolveIcon(s.icon, s.name),
        iconDark: s.iconDark ? resolveIcon(s.iconDark, s.name) : null,
        level: lvl,
        status: p.down ? 'Down' : status,
        line: line || (lvl === 'ok' ? 'Online' : ''),
        lineLevel,
        stats: (w?.stats || []).slice(0, 3),
        pinned: s.pinned,
        opens: opens[s.id] || 0,
        uptime24: ps?.up24 ?? null,
        uptime7: ps?.up7 ?? null,
        p95: ps?.p95 ?? null,
        cert
      });
    }
  }

  attention.sort((a, b) => RANK[b.sev] - RANK[a.sev] || b.ts - a.ts);
  const needs = attention.filter((a) => a.sev === 'crit' || a.sev === 'warn');
  const all = [...tiles.values()];
  const probed = all.filter((t) => t.level !== 'unknown');
  const up = probed.filter((t) => t.status !== 'Down').length;

  // ---- host vitals ----
  const hostSvc = engine.cfg.services.find((s) => (settings.host.service ? s.name === settings.host.service : s.widget?.type === 'proxmox'));
  const hw = hostSvc ? engine.state(hostSvc.id).widget?.host : null;
  const since24 = now - 24 * H;
  const spark = (key) => series(key, since24, now, 48).values;
  let host = null;
  if (hw || engine.temps) {
    const temps = engine.temps;
    /** @type {Gauge[]} */
    const gauges = [];
    if (hw) {
      gauges.push({ key: 'cpu', label: 'CPU', val: Math.round(hw.cpu), unit: '%', pct: hw.cpu, level: level(hw.cpu, 75, 90), sub: `${hw.cpus} threads`, series: spark('host.cpu'), max: 100 });
      gauges.push({ key: 'mem', label: 'Memory', val: (hw.mem / 1024 ** 3).toFixed(1), unit: `of ${Math.round(hw.maxmem / 1024 ** 3)} GiB`, pct: hw.memPct, level: level(hw.memPct, 80, 92), sub: `${Math.round(hw.memPct)}% used`, series: spark('host.mem'), max: 100 });
      gauges.push({ key: 'disk', label: 'Storage', val: Math.round(hw.disk.pct), unit: '%', pct: hw.disk.pct, level: level(hw.disk.pct, th.storageAmberPct, th.storageWarnPct), sub: hw.disk.name, series: null });
    }
    if (temps?.cpu != null) {
      const span = th.tempWarnC + 15 - th.tempMinC;
      const tp = Math.max(0, Math.min(100, ((temps.cpu - th.tempMinC) / span) * 100));
      gauges.push({ key: 'temp', label: 'CPU temp', val: Math.round(temps.cpu), unit: '°C', pct: tp, level: level(temps.cpu, th.tempWarnC, th.tempWarnC + 10), sub: temps.nvme.length ? `NVMe ${Math.round(Math.max(...temps.nvme))} °C` : temps.cpuLabel, series: spark('host.temp'), max: null });
      if (temps.cpu >= th.tempWarnC) attention.push({ sev: temps.cpu >= th.tempWarnC + 10 ? 'crit' : 'warn', title: `CPU at ${Math.round(temps.cpu)} °C`, detail: `limit ${th.tempWarnC} °C`, href: hostSvc?.href, ts: now });
      for (const n of temps.nvme) if (n >= 70) attention.push({ sev: 'warn', title: `NVMe at ${Math.round(n)} °C`, detail: 'drive is running hot', href: hostSvc?.href, ts: now });
    }
    host = {
      name: hw?.node ?? 'host',
      href: hostSvc?.href ?? null,
      detail: hw ? [`up ${hw.uptime}`, `${hw.guestsRunning} of ${hw.guestsTotal} guests running`].join(' · ') : '',
      load: hw?.load ? hw.load.map((l) => l.toFixed(2)).join(' · ') : null,
      gauges
    };
  }

  // ---- storage ----
  /** @type {Snapshot['storage']} */
  const storage = [];
  for (const s of engine.cfg.services) {
    const w = engine.state(s.id).widget;
    for (const x of w?.storage || []) {
      // unavailable or detached: shown muted without a bar, the widget raises any alert itself
      if (x.offline) { storage.push({ name: x.name, pct: null, level: 'off', sub: x.sub, href: s.href }); continue; }
      /** @type {Level} */
      const lv = x.pct >= th.storageWarnPct ? 'crit' : x.pct >= th.storageAmberPct ? 'warn' : 'ok';
      storage.push({ name: x.name, pct: x.pct, level: lv, sub: x.sub ?? fmtPair(x.used, x.total), href: s.href });
      if (x.pct >= th.storageWarnPct) attention.push({ sev: 'warn', title: `${x.name} is ${Math.round(x.pct)}% full`, detail: x.sub, href: s.href, ts: now });
    }
  }

  // ---- network ----
  let network = null;
  const widgets = engine.cfg.services.map((s) => ({ s, w: engine.state(s.id).widget })).filter((x) => x.w);
  const netPick = settings.network?.service;
  const net = netPick
    ? widgets.find((x) => x.s.name === netPick && x.w.network)
    : widgets.find((x) => x.w.network && !x.w.network.fallback) || widgets.find((x) => x.w.network);
  const dns = widgets.find((x) => x.w.dns);
  if (net || dns) {
    const key = net?.w.network.fallback ? 'fritz' : 'net';
    const sDown = net ? series(`${key}.down`, since24, now, 72) : null;
    const sUp = net ? series(`${key}.up`, since24, now, 72) : null;
    network = {
      source: net?.w.network.source ?? null,
      href: net?.s.href ?? null,
      down: net?.w.network.down ?? null,
      up: net?.w.network.up ?? null,
      seriesDown: sDown?.values ?? null,
      seriesUp: sUp?.values ?? null,
      spanH: sDown ? Math.max(1, Math.round((now - sDown.from) / H)) : null,
      dns: dns ? { ...dns.w.dns, href: dns.s.href } : null
    };
  }

  // ---- fleet availability strip (48 × 30 min) ----
  const B = 30 * 60_000;
  const start = now - 48 * B;
  /** @type {Snapshot['fleet']} */
  const buckets = Array.from({ length: 48 }, () => 'none');
  for (const r of probeBuckets(start, B)) {
    const i = Math.max(0, Math.min(47, Math.floor(Number(r.b))));
    const ratio = r.fails / r.n;
    /** @type {Level} */
    const lv = ratio >= 0.5 ? 'crit' : ratio >= 0.1 || r.maxms > th.latencyWarnMs * 2 ? 'warn' : 'ok';
    if (buckets[i] === 'none' || RANK[lv] > RANK[buckets[i]]) buckets[i] = lv;
  }
  const ups = all.map((t) => t.uptime24).filter((x) => x != null);
  const fleetAvail = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;

  // ---- alert age ----
  const seenNow = new Set();
  for (const a of attention) {
    const k = `${a.sid ?? ''}|${a.key ?? a.title}`;
    seenNow.add(k);
    if (!firstSeen.has(k)) firstSeen.set(k, Math.min(a.ts ?? now, now));
    a.ts = Math.min(a.ts ?? now, firstSeen.get(k));
  }
  for (const k of firstSeen.keys()) if (!seenNow.has(k)) firstSeen.delete(k);

  // ---- verdict ----
  attention.sort((a, b) => RANK[b.sev] - RANK[a.sev] || b.ts - a.ts);
  const needCount = attention.filter((a) => a.sev === 'crit' || a.sev === 'warn').length;
  const backups = widgets.find((x) => x.w.backups)?.w.backups;
  const certWarn = all.filter((t) => t.cert && t.cert.days < th.certWarnDays).length;
  const subParts = [`${up} of ${probed.length} services up`];
  if (backups?.known) subParts.push(backups.overdue ? `${backups.overdue} backup${backups.overdue > 1 ? 's' : ''} overdue` : 'backups current');
  subParts.push(certWarn ? `${certWarn} certificate${certWarn > 1 ? 's' : ''} expiring` : 'no certs expiring soon');
  const top = attention[0];
  /** @type {Snapshot['verdict']} */
  const verdict = needCount
    // needCount > 0: the top item is crit or warn, never info
    ? { level: /** @type {Level} */ (top.sev), tag: `${needCount} ${needCount === 1 ? 'needs' : 'need'} attention`, title: `${top.title}.`, sub: subParts.join(' · ') }
    : { level: 'ok', tag: 'All systems normal', title: 'Everything is running.', sub: subParts.join(' · ') };

  const containers = engine.shared.containers;
  const nextCert = all.filter((t) => t.cert && !t.cert.selfSigned).sort((a, b) => a.cert.days - b.cert.days)[0];
  const facts = /** @type {(Fact | false | undefined)[]} */ ([
    { k: 'services up', v: `${up} / ${probed.length}`, level: up < probed.length ? 'crit' : null },
    containers && { k: 'containers running', v: `${containers.running} / ${containers.total}`, level: containers.failed ? 'warn' : null },
    backups?.oldestAge != null && { k: 'oldest backup', v: fmtAge(backups.oldestAge), level: backups.overdue ? 'warn' : null },
    nextCert && { k: 'next cert expiry', v: `${nextCert.cert.days} d`, level: nextCert.cert.days < th.certWarnDays ? 'warn' : null }
  ]).filter(/** @returns {f is Fact} */ (f) => !!f);

  const events = recentEvents(now - 24 * H, 5).map((e) => ({ ...e, href: tiles.get(e.sid)?.href ?? null }));

  const pinned = all
    .filter((t) => t.pinned)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.opens - a.t.opens || a.i - b.i)
    .map((x) => x.t);

  return {
    generatedAt: now,
    demo: DEMO,
    title: settings.title,
    linkTarget: settings.linkTarget,
    deepLink: settings.deepLink,
    logo: assetUrl(settings.pwa.logo),
    staleAfter: Math.max(settings.intervals.widgets, settings.intervals.probe) * 2.5 * 1000,
    verdict,
    facts,
    attention,
    needCount,
    events,
    fleet: buckets,
    fleetAvail,
    host,
    storage,
    network,
    pinned,
    groups: groups.map((g) => {
      const ts = g.services.map((s) => tiles.get(s.id));
      const known = ts.filter((t) => t.level !== 'unknown');
      return { name: g.name, summary: `${known.filter((t) => t.status !== 'Down').length} / ${known.length} up`, services: ts };
    }),
    bookmarks: bookmarks.map((b) => ({ ...b, icon: resolveIcon(b.icon, b.name), iconDark: b.iconDark ? resolveIcon(b.iconDark, b.name) : null }))
  };
}
