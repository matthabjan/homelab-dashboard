// OpenMediaVault — JSON-RPC with session login (same credentials as homepage).
// Reads services, SMART status and mounted file systems in one go.
import { request, trimUrl } from '../http.js';
import { fmtPair, pct } from '../format.js';

async function rpc(url, body, st, insecure) {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(st.cookie ? { Cookie: st.cookie } : {}) },
    body: JSON.stringify(body),
    insecure
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) st.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function call(w, st, service, method, params, insecure) {
  const url = trimUrl(w.url) + '/rpc.php';
  let r = await rpc(url, { service, method, params }, st, insecure);
  if (r.status === 401 || r.json?.error?.code === 5001) {
    const login = await rpc(url, { service: 'session', method: 'login', params: { username: String(w.username), password: String(w.password) } }, st, insecure);
    const ok = login.json?.response?.authenticated === true || login.json?.response?.status === 'authenticated';
    if (!ok) throw new Error('OMV login failed');
    r = await rpc(url, { service, method, params }, st, insecure);
  }
  if (r.status !== 200 || r.json?.error) {
    const err = new Error(`OMV ${service}.${method} failed (HTTP ${r.status})`);
    err.body = r.json?.error?.message;
    throw err;
  }
  return r.json.response;
}

async function callBg(w, st, service, method, insecure) {
  const filename = await call(w, st, service, method, { limit: -1, start: 0 }, insecure);
  let pos = 0;
  for (let i = 0; i < 40; i++) {
    const out = await call(w, st, 'exec', 'getOutput', { pos, filename }, insecure);
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
  return disks.find((d) => candidates.includes(d.devicefile)) ?? null;
}

export async function collect(w, ctx) {
  const st = ctx.state;
  const ins = ctx.insecure;
  const [services, smart, fs] = await Promise.all([
    call(w, st, 'services', 'getStatus', { limit: -1, start: 0 }, ins).then((r) => r?.data ?? r).catch(() => null),
    callBg(w, st, 'smart', 'getListBg', ins).then((r) => r?.data ?? null).catch(() => null),
    call(w, st, 'filesystemmgmt', 'enumerateMountedFilesystems', { includeroot: false }, ins).catch(() => null)
  ]);
  if (!services && !smart && !fs) throw new Error('No data from OMV RPC');

  const alerts = [];
  const enabled = (services || []).filter((s) => s.enabled !== false);
  const svcRunning = enabled.filter((s) => s.running).length;
  for (const s of enabled.filter((s) => !s.running)) alerts.push({ sev: 'warn', title: `NAS service ${s.title || s.name} stopped`, detail: 'Enabled in OMV but not running' });

  const disks = (smart || []).filter((d) => d.monitor);
  const good = disks.filter((d) => d.overallstatus === 'GOOD').length;
  for (const d of disks.filter((d) => d.overallstatus !== 'GOOD')) {
    alerts.push({ sev: 'crit', title: `SMART warning on ${d.devicefile || d.model}`, detail: `Status ${d.overallstatus}` });
  }

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
      { k: 'pool', v: main ? `${Math.round(main.pct)}%` : '—', level: main && main.pct >= ctx.settings.thresholds.storageAmberPct ? 'warn' : null },
      { k: 'SMART', v: disks.length ? `${good} / ${disks.length}` : '—', level: good < disks.length ? 'crit' : null },
      { k: 'services', v: services ? `${svcRunning} / ${enabled.length}` : '—' }
    ],
    line: [main && `Pool ${Math.round(main.pct)}%`, disks.length && `SMART ${good} / ${disks.length} ok`].filter(Boolean).join(' · ') || 'Online',
    alerts,
    storage
  };
}
