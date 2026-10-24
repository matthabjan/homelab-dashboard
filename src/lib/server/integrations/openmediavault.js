// OpenMediaVault — JSON-RPC with session login (same credentials as homepage).
// Reads services, SMART status and mounted file systems in one go.
import { trimUrl } from '../http.js';
import { fmtPair, fmtPct, pct } from '../format.js';
import { attributesFromText, fromAttributes, fromNvmeText, slowly, toDrive } from './smart.js';
/** @import { Alert, UsageRow, Context, Drive, Widget, WidgetResult } from '$lib/types' */

async function rpc(ctx, url, body) {
  const st = ctx.state;
  const res = await ctx.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(st.cookie ? { Cookie: st.cookie } : {}) },
    body: JSON.stringify(body),
    insecure: ctx.insecure
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) st.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function call(w, ctx, service, method, params) {
  const url = trimUrl(w.url) + '/rpc.php';
  let r = await rpc(ctx, url, { service, method, params });
  if (r.status === 401 || r.json?.error?.code === 5001) {
    const login = await rpc(ctx, url, { service: 'session', method: 'login', params: { username: String(w.username), password: String(w.password) } });
    const ok = login.json?.response?.authenticated === true || login.json?.response?.status === 'authenticated';
    if (!ok) throw new Error('OMV login failed');
    r = await rpc(ctx, url, { service, method, params });
  }
  if (r.status !== 200 || r.json?.error) {
    const err = /** @type {Error & { body?: string }} */ (new Error(`OMV ${service}.${method} failed (HTTP ${r.status})`));
    err.body = r.json?.error?.message;
    throw err;
  }
  return r.json.response;
}

async function callBg(w, ctx, service, method) {
  const filename = await call(w, ctx, service, method, { limit: -1, start: 0 });
  let pos = 0;
  for (let i = 0; i < 40; i++) {
    const out = await call(w, ctx, 'exec', 'getOutput', { pos, filename });
    if (out.running === true || out.outputPending) {
      pos = out.pos;
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    return JSON.parse(out.output || '{}');
  }
  throw new Error('OMV background job timed out');
}

/**
 * The monitored SMART disk a file system lives on, or null (e.g. a virtual disk in a VM has no SMART).
 * Matches the parent device first, then the device itself with any partition suffix removed.
 */
function diskOf(f, disks) {
  const dev = f.canonicaldevicefile || f.devicefile || '';
  const candidates = [f.parentdevicefile, dev, dev.replace(/p?\d+$/, '')].filter(Boolean);
  // OMV's devicefile is a /dev/disk/by-id link; the plain /dev/sdX is canonicaldevicefile
  return disks.find((d) => candidates.includes(d.canonicaldevicefile) || candidates.includes(d.devicefile)) ?? null;
}

/**
 * Drives from OMV's SMART list (only disks with monitoring on: passed-through disks; virtual disks have none).
 * Hours, wear and bytes written come from smartctl's extended output, refreshed every 10 minutes.
 * @param {Widget} w @param {Context} ctx @param {any[]} disks
 * @returns {Promise<Drive[]>}
 */
function omvDrives(w, ctx, disks) {
  return Promise.all(disks.map(async (d) => {
    const dev = d.canonicaldevicefile || d.devicefile;
    const text = await slowly(ctx, `smart ${dev}`, async () => {
      const r = await call(w, ctx, 'smart', 'getExtendedInformation', { devicefile: d.devicefile });
      return typeof r === 'string' ? r : r?.output ?? '';
    });
    const nvme = /NVMe Log/i.test(text ?? '');
    const reading = !text ? null : nvme ? fromNvmeText(text) : fromAttributes(attributesFromText(text));
    const kind = /\/usb-/.test(d.devicefile ?? '') ? 'USB' : nvme ? 'NVMe' : /Rotation Rate:\s+\d+ rpm/i.test(text ?? '') ? 'HDD' : 'SSD';
    // the list's temperature is fresher than the 10-minute details, and still there when they fail
    const tempC = Number(d.temperature) || reading?.tempC || null;
    const smart = reading ? { ...reading, tempC } : { tempC, hours: null, written: null, lifeLeft: null, errors: null, failing: false };
    return toDrive({ model: d.model, serial: d.serialnumber || null, kind, size: Number(d.size), status: d.overallstatus, smart });
  }));
}

/**
 * @param {Widget} w
 * @param {Context} ctx
 * @returns {Promise<WidgetResult>}
 */
export async function collect(w, ctx) {
  const [services, smart, fs] = await Promise.all([
    call(w, ctx, 'services', 'getStatus', { limit: -1, start: 0 }).then((r) => r?.data ?? r).catch(() => null),
    callBg(w, ctx, 'smart', 'getListBg').then((r) => r?.data ?? null).catch(() => null),
    call(w, ctx, 'filesystemmgmt', 'enumerateMountedFilesystems', { includeroot: false }).catch(() => null)
  ]);
  if (!services && !smart && !fs) throw new Error('No data from OMV RPC');

  /** @type {Alert[]} */
  const alerts = [];
  const enabled = (services || []).filter((s) => s.enabled !== false);
  const svcRunning = enabled.filter((s) => s.running).length;
  for (const s of enabled.filter((s) => !s.running)) alerts.push({ sev: 'warn', title: `NAS service ${s.title || s.name} stopped`, detail: 'Enabled in OMV but not running' });

  const disks = (smart || []).filter((d) => d.monitor);
  const good = disks.filter((d) => d.overallstatus === 'GOOD').length;
  for (const d of disks.filter((d) => d.overallstatus !== 'GOOD')) {
    alerts.push({ sev: 'crit', title: `SMART warning on ${d.devicefile || d.model}`, detail: `Status ${d.overallstatus}` });
  }

  /** @type {UsageRow[]} */
  const storage = (Array.isArray(fs) ? fs : [])
    .filter((f) => Number(f.size) > 0 && f.mountpoint !== '/')
    .map((f) => {
      const total = Number(f.size), avail = Number(f.available);
      const used = Number.isFinite(avail) ? total - avail : Number(f.used);
      const dev = f.canonicaldevicefile || f.devicefile;
      const disk = diskOf(f, disks);
      return { name: `${f.label || (dev ? dev.replace(/^\/dev\//, '') : f.mountpoint)} · NAS`, used, total, pct: pct(used, total), sub: fmtPair(used, total) + (disk ? ` · SMART ${disk.overallstatus === 'GOOD' ? 'ok' : 'warning'}` : ''), source: 'omv' };
    });
  for (const s of storage) ctx.metric(`storage.omv.${s.name}`, s.pct);
  const main = [...storage].sort((a, b) => b.total - a.total)[0];

  return {
    stats: [
      { k: 'pool', v: fmtPct(main?.pct), level: (main?.pct ?? 0) >= ctx.settings.thresholds.storageAmberPct ? 'warn' : null },
      { k: 'SMART', v: disks.length ? `${good} / ${disks.length}` : '—', level: good < disks.length ? 'crit' : null },
      { k: 'services', v: services ? `${svcRunning} / ${enabled.length}` : '—' }
    ],
    line: [main && `Pool ${fmtPct(main.pct)}`, disks.length && `SMART ${good} / ${disks.length} ok`].filter(Boolean).join(' · ') || 'Online',
    alerts,
    storage,
    drives: await omvDrives(w, ctx, disks)
  };
}
