// DEMO=1 — preview the UI without any homelab APIs. DEMO_SCENARIO=issues (default) | calm
// Widgets run the real integrations on the API fixtures in ./demo/; this file only fakes what has no
// integration logic behind it: probes, certificates, temperatures and the first day of history.
import { insertProbe, insertMetric, countProbes, transaction, insertEvent } from './db.js';

export const DEMO = !!process.env.DEMO && process.env.DEMO !== '0';
export const SCENARIO = process.env.DEMO_SCENARIO === 'calm' ? 'calm' : 'issues';
const calm = () => SCENARIO === 'calm';

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
      insertEvent(now - 13 * 3600_000, 'ok', null, 'Backups completed', '6 guests · main');
      insertEvent(now - 5 * 3600_000, 'info', null, '12 updates available on pve', 'apt packages pending');
    } else {
      insertEvent(now - 68 * 60_000, 'crit', 'entertainment-musicassistant', 'MusicAssistant went down', 'Connection refused');
      insertEvent(now - 13 * 3600_000, 'ok', null, 'Backups completed', '5 guests · main');
    }
  });
}
