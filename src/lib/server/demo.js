// DEMO=1 — fake data for previewing the UI without any homelab APIs.
// DEMO_SCENARIO=issues (default) | calm
import { insertProbe, insertMetric, countProbes, transaction, insertEvent } from './db.js';
import { fmtPair, GiB, TiB } from './format.js';

export const DEMO = !!process.env.DEMO && process.env.DEMO !== '0';
const calm = () => process.env.DEMO_SCENARIO === 'calm';

const isDown = (s) => !calm() && /music/i.test(s.name);
const isSlow = (s) => !calm() && /deco/i.test(s.name);
const baseMs = (s) => 6 + ((s.name.length * 7) % 35);

function rnd(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

export function demoProbe(s, now) {
  if (isDown(s)) return { ok: false, ms: null, code: 'ECONNREFUSED' };
  const r = Math.random();
  return { ok: true, ms: isSlow(s) ? 180 + r * 260 : baseMs(s) + r * 12, code: 200 };
}

export function demoCert(s) {
  if (!s.probe?.startsWith('https')) return null;
  if (/192\.168/.test(s.probe)) return { validTo: Date.now() + 300 * 86_400_000, trusted: false, selfSigned: true };
  const days = !calm() && /opnsense/i.test(s.name) ? 9 : 68;
  return { validTo: Date.now() + days * 86_400_000 + 3_600_000, trusted: true, selfSigned: false };
}

export function demoTemps() {
  return { cpu: 48 + Math.random() * 6, cpuLabel: 'coretemp', nvme: [44], drives: [] };
}

export async function demoCollect(type, w, ctx) {
  const t = Date.now() / 60000;
  const cpu = 18 + Math.sin(t / 7) * 6 + Math.random() * 4;
  switch (type) {
    case 'proxmox': {
      ctx.metric('host.cpu', cpu);
      ctx.metric('host.mem', 64 + Math.random());
      ctx.shared.guestIds = new Set(['100', '101', '102', '103', '104', '105']);
      ctx.shared.guestNames = { 100: 'opnsense', 101: 'docker-apps', 102: 'homeassistant', 103: 'omv', 104: 'pbs', 105: 'adguard' };
      const storage = [{ name: 'local-zfs', used: 532 * GiB, total: 920 * GiB, pct: 57.8, sub: fmtPair(532 * GiB, 920 * GiB), source: 'pve' }];
      return {
        stats: [{ k: 'CPU', v: `${Math.round(cpu)}%` }, { k: 'RAM', v: '41.2 / 64 GiB' }, { k: 'guests', v: '6 / 7' }],
        line: `CPU ${Math.round(cpu)}% · RAM 41.2 / 64 GiB`,
        alerts: [{ sev: 'info', key: 'updates', title: '12 updates available on pve', detail: 'apt packages pending' }],
        storage,
        host: { node: 'pve', cpu, cpus: 16, mem: 41.2 * GiB, maxmem: 64 * GiB, memPct: 64.4, disk: { name: 'local-zfs', pct: 57.8, sub: fmtPair(532 * GiB, 920 * GiB) }, load: [1.42, 1.38, 1.21], uptime: '38 d', guestsRunning: 6, guestsTotal: 7, updates: 12 }
      };
    }
    case 'proxmoxbackupserver': {
      const overdue = !calm();
      return {
        stats: [{ k: 'oldest backup', v: overdue ? '30 h' : '6 h', level: overdue ? 'warn' : null }, { k: 'datastore', v: '62%' }, { k: 'groups', v: '6' }],
        line: overdue ? '1 backup overdue' : 'Last backup 6 h ago · store 62%',
        alerts: overdue ? [{ sev: 'warn', key: 'backup-103', title: 'Backup overdue', detail: '103 omv · last success 30 h ago' }] : [],
        storage: [{ name: 'pbs-main · backups', used: 1.24 * TiB, total: 2 * TiB, pct: 62, sub: fmtPair(1.24 * TiB, 2 * TiB) + ' · dedup 14.2×', source: 'pbs' }],
        backups: { overdue: overdue ? 1 : 0, oldestAge: overdue ? 30 * 3600_000 : 6 * 3600_000, known: true }
      };
    }
    case 'opnsense': {
      const down = 40 + Math.random() * 60, up = 6 + Math.random() * 10;
      ctx.metric('net.down', down);
      ctx.metric('net.up', up);
      return {
        stats: [{ k: 'WAN ↓ Mbit/s', v: down.toFixed(0) }, { k: 'WAN ↑ Mbit/s', v: up.toFixed(1) }, { k: 'CPU', v: '4%' }],
        line: `WAN ${down.toFixed(0)} / ${up.toFixed(1)} Mbit/s`,
        alerts: [],
        network: { down, up, source: 'OPNsense' }
      };
    }
    case 'fritzbox': {
      const down = 30 + Math.random() * 80, up = 4 + Math.random() * 12;
      ctx.metric('fritz.down', down);
      ctx.metric('fritz.up', up);
      return { stats: [{ k: 'internet', v: 'online', level: 'ok' }, { k: 'max ↓ Mbit/s', v: '250' }, { k: 'max ↑ Mbit/s', v: '40' }], line: 'Online · 250 / 40 Mbit/s · up 12 d', alerts: [], network: { down, up, source: 'FRITZ!Box', fallback: true } };
    }
    case 'adguard': {
      const series = Array.from({ length: 24 }, (_, i) => 1400 + Math.round(Math.sin((i - 6) / 3.8) * 900 + 900));
      return {
        stats: [{ k: 'queries', v: '48.2k' }, { k: 'blocked', v: '18.4%' }, { k: 'avg', v: '4 ms' }],
        line: '48.2k queries · 18.4% blocked',
        alerts: [],
        dns: { queries: 48213, blockedPct: 18.4, avgMs: 4, series }
      };
    }
    case 'portainer': {
      const bad = !calm();
      ctx.shared.containers = { running: bad ? 24 : 25, total: 25, failed: bad ? 1 : 0, unhealthy: 0 };
      return {
        stats: [{ k: 'running', v: bad ? '24' : '25' }, { k: 'stopped', v: bad ? '1' : '0', level: bad ? 'crit' : null }, { k: 'unhealthy', v: '0' }],
        line: bad ? '24 / 25 running · 1 failed' : '25 / 25 running',
        alerts: bad ? [{ sev: 'warn', key: 'ct-music-assistant', title: 'Container music-assistant stopped', detail: 'Exited (1) 1 hour ago · 5 restarts' }] : [],
        containers: ctx.shared.containers,
        discovered: [{ group: 'Management', name: 'Traefik', def: { icon: 'traefik', href: 'https://traefik.home.arpa', description: 'Reverse proxy · from container labels', siteMonitor: 'https://traefik.home.arpa' }, container: { state: 'running', health: null, exitCode: 0 } },
          { group: 'Management', name: 'What\'s Up Docker', def: { icon: 'whats-up-docker', href: 'https://wud.home.arpa', description: 'Image updates · container state only' }, container: { state: 'running', health: 'healthy', exitCode: 0 } }]
      };
    }
    case 'openmediavault':
      return {
        stats: [{ k: 'pool', v: '71%', level: 'warn' }, { k: 'SMART', v: '4 / 4' }, { k: 'services', v: '3 / 3' }],
        line: 'Pool 71% · SMART 4 / 4 ok',
        alerts: [],
        storage: [{ name: 'data · NAS', used: 5.7e12, total: 8e12, pct: 71.3, sub: '5.2 / 7.3 TiB · SMART ok', source: 'omv' }]
      };
    default:
      return { stats: [], line: null, alerts: [] };
  }
}

/** Fill 24 h of history so sparklines and the availability strip have something to show. */
export function seedHistory(services) {
  if (countProbes() > 0) return;
  const now = Date.now();
  const r = rnd('seed');
  transaction(() => {
    for (const s of services.filter((x) => x.probe)) {
      for (let ts = now - 86_400_000; ts < now; ts += 120_000) {
        const down = isDown(s) && ts > now - 68 * 60_000;
        const blip = r() < 0.0015;
        insertProbe(s.id, ts, !(down || blip), down || blip ? null : isSlow(s) ? 150 + r() * 300 : baseMs(s) + r() * 14);
      }
    }
    for (let ts = now - 86_400_000, i = 0; ts < now; ts += 300_000, i++) {
      const day = Math.sin((i / 288) * Math.PI * 2 - 1.2);
      insertMetric('host.cpu', ts, 16 + day * 8 + r() * 10 + (i % 288 > 20 && i % 288 < 30 ? 25 : 0));
      insertMetric('host.mem', ts, 62 + day * 2 + r());
      insertMetric('host.temp', ts, 46 + day * 4 + r() * 3);
      insertMetric('net.down', ts, Math.max(2, 50 + day * 45 + r() * 60 + (r() < 0.05 ? 120 : 0)));
      insertMetric('net.up', ts, Math.max(1, 8 + day * 5 + r() * 8));
    }
    if (calm()) {
      insertEvent(now - 13 * 3600_000, 'ok', null, 'Backups completed', '6 guests · pbs-main');
      insertEvent(now - 5 * 3600_000, 'info', null, '12 updates available on pve', 'apt packages pending');
    } else {
      insertEvent(now - 68 * 60_000, 'crit', 'entertainment-musicassistant', 'MusicAssistant went down', 'Connection refused');
      insertEvent(now - 13 * 3600_000, 'ok', null, 'Backups completed', '5 guests · pbs-main');
    }
  });
}
