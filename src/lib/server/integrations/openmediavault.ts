// OpenMediaVault — JSON-RPC with session login (same credentials as homepage).
// Reads services, pending updates, SMART status and mounted file systems in one go.
import { trimUrl } from '../http.ts';
import { fmtPair, fmtPct, pct } from '../format.ts';
import { attributesFromText, fromAttributes, fromNvmeText, slowly, toDrive } from './smart.ts';
import type { Alert, UsageRow, Context, Drive, SmartReading, Widget, WidgetResult } from '$lib/types';

/** What /rpc.php is sent. */
export interface OmvRpcRequest {
  service: string;
  method: string;
  params: object | null;
}

/** What /rpc.php answers; error code 5001 means the session expired. */
export interface OmvRpcResponse<T = unknown> {
  response: T;
  error: { code?: number; message?: string } | null;
}

/** session.login; OMV 7 says `authenticated: true`, some versions `status: "authenticated"`. */
export interface OmvLogin {
  authenticated?: boolean;
  status?: string;
}

/** A list answer (`{ total, data }`). */
export interface OmvList<T> {
  data: T[];
  total?: number;
}

/** One entry of services.getStatus. */
export interface OmvServiceStatus {
  name: string;
  title?: string;
  enabled?: boolean;
  running?: boolean;
}

/** system.getInformation; the package and reboot fields only reach admins. */
export interface OmvSystemInformation {
  hostname?: string;
  version?: string;
  availablePkgUpdates?: number;
  rebootRequired?: boolean;
  configDirty?: boolean;
}

/** exec.getOutput, polled for a background job (`…Bg` methods answer with its file name). */
export interface OmvExecOutput {
  running?: boolean;
  outputPending?: boolean;
  pos: number;
  /** the job's JSON result once it is done */
  output?: string;
}

/** A disk in smart.getListBg's result; sizes and temperatures come as strings. */
export interface OmvSmartDevice {
  devicefile: string;
  canonicaldevicefile?: string;
  model: string;
  serialnumber?: string;
  size: string;
  temperature?: string | number;
  monitor: boolean;
  overallstatus: string;
}

/** smart.getExtendedInformation: smartctl -x text, bare or wrapped. */
export type OmvSmartExtended = string | { output?: string };

/** One entry of filesystemmgmt.enumerateMountedFilesystems; sizes are strings of bytes. */
export interface OmvFilesystem {
  label?: string;
  devicefile?: string;
  canonicaldevicefile?: string;
  parentdevicefile?: string;
  mountpoint: string;
  size: string;
  available?: string;
  used?: string;
}

async function rpc<T>(ctx: Context, url: string, body: OmvRpcRequest): Promise<{ status: number; json: OmvRpcResponse<T> | null }> {
  const st = ctx.state as { cookie?: string };
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

async function call<T>(w: Widget, ctx: Context, service: string, method: string, params: object | null): Promise<T> {
  const url = trimUrl(w.url) + '/rpc.php';
  let r = await rpc<T>(ctx, url, { service, method, params });
  if (r.status === 401 || r.json?.error?.code === 5001) {
    const login = await rpc<OmvLogin>(ctx, url, { service: 'session', method: 'login', params: { username: String(w.username), password: String(w.password) } });
    const ok = login.json?.response?.authenticated === true || login.json?.response?.status === 'authenticated';
    if (!ok) throw new Error('OMV login failed');
    r = await rpc(ctx, url, { service, method, params });
  }
  if (r.status !== 200 || r.json?.error) {
    const err = (new Error(`OMV ${service}.${method} failed (HTTP ${r.status})`) as Error & { body?: string });
    err.body = r.json?.error?.message;
    throw err;
  }
  // an empty 200 answer throws here, as it always did
  return r.json!.response;
}

async function callBg<T>(w: Widget, ctx: Context, service: string, method: string): Promise<T> {
  const filename = await call<string>(w, ctx, service, method, { limit: -1, start: 0 });
  let pos = 0;
  for (let i = 0; i < 40; i++) {
    const out = await call<OmvExecOutput>(w, ctx, 'exec', 'getOutput', { pos, filename });
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
 * Drives from OMV's SMART list (only disks with monitoring on: passed-through disks; virtual disks have none).
 * Hours, wear and bytes written come from smartctl's extended output, refreshed every 10 minutes.
 */
function omvDrives(w: Widget, ctx: Context, disks: OmvSmartDevice[]): Promise<Drive[]> {
  return Promise.all(disks.map(async (d) => {
    const dev = d.canonicaldevicefile || d.devicefile;
    const text = await slowly(ctx, `smart ${dev}`, async () => {
      const r = await call<OmvSmartExtended | null>(w, ctx, 'smart', 'getExtendedInformation', { devicefile: d.devicefile });
      return typeof r === 'string' ? r : r?.output ?? '';
    });
    const nvme = /NVMe Log/i.test(text ?? '');
    const reading: SmartReading | null = !text ? null : nvme ? fromNvmeText(text) : fromAttributes(attributesFromText(text));
    const kind: Drive['kind'] = /\/usb-/.test(d.devicefile ?? '') ? 'USB' : nvme ? 'NVMe' : /Rotation Rate:\s+\d+ rpm/i.test(text ?? '') ? 'HDD' : 'SSD';
    // the list's temperature is fresher than the 10-minute details, and still there when they fail
    const tempC = Number(d.temperature) || reading?.tempC || null;
    const smart: SmartReading = reading ? { ...reading, tempC } : { tempC, hours: null, written: null, lifeLeft: null, errors: null, failing: false };
    return toDrive({ model: d.model, serial: d.serialnumber || null, kind, size: Number(d.size), status: d.overallstatus, smart });
  }));
}

export async function collect(w: Widget, ctx: Context): Promise<WidgetResult> {
  const [services, info, smart, fs] = await Promise.all([
    // OMV 6+ answers { total, data }, older versions the bare list
    call<OmvList<OmvServiceStatus> | OmvServiceStatus[] | null>(w, ctx, 'services', 'getStatus', { limit: -1, start: 0 })
      .then((r) => (r as Partial<OmvList<OmvServiceStatus>> | null)?.data ?? (r as OmvServiceStatus[] | null))
      .catch(() => null),
    call<OmvSystemInformation | null>(w, ctx, 'system', 'getInformation', null).catch(() => null),
    callBg<Partial<OmvList<OmvSmartDevice>> | null>(w, ctx, 'smart', 'getListBg').then((r) => r?.data ?? null).catch(() => null),
    call<OmvFilesystem[] | null>(w, ctx, 'filesystemmgmt', 'enumerateMountedFilesystems', { includeroot: false }).catch(() => null)
  ]);
  if (!services && !info && !smart && !fs) throw new Error('No data from OMV RPC');

  const alerts: Alert[] = [];
  const enabled = (services || []).filter((s) => s.enabled !== false);
  const svcRunning = enabled.filter((s) => s.running).length;
  const stopped = enabled.length - svcRunning;
  for (const s of enabled.filter((s) => !s.running)) alerts.push({ sev: 'warn', key: `service-${s.name}`, title: `NAS service ${s.title || s.name} stopped`, detail: 'Enabled in OMV but not running' });

  // only sent to admins; a non-admin login gets hostname and time only
  const updates = typeof info?.availablePkgUpdates === 'number' ? info.availablePkgUpdates : null;
  if (updates) alerts.push({ sev: 'info', key: 'updates', title: `${updates} updates available on ${info?.hostname || 'NAS'}`, detail: 'apt packages pending' });

  const disks = (smart || []).filter((d) => d.monitor);
  // a drive that isn't GOOD is raised by the Drives panel, which also colours this tile
  const good = disks.filter((d) => d.overallstatus === 'GOOD').length;

  const volumes = (Array.isArray(fs) ? fs : [])
    .filter((f) => Number(f.size) > 0 && f.mountpoint !== '/')
    .map((f) => {
      const total = Number(f.size), avail = Number(f.available);
      const used = Number.isFinite(avail) ? total - avail : Number(f.used);
      const dev = f.canonicaldevicefile || f.devicefile;
      const label = f.label || (dev ? dev.replace(/^\/dev\//, '') : f.mountpoint);
      return { label, row: { name: `${label} · NAS`, used, total, pct: pct(used, total), sub: fmtPair(used, total), source: 'omv' } satisfies UsageRow };
    });
  const storage: UsageRow[] = volumes.map((v) => v.row);
  for (const s of storage) ctx.metric(`storage.omv.${s.name}`, s.pct);
  // the root file system is left out above, so this is the fullest data disk
  const fullest = [...volumes].sort((a, b) => (b.row.pct ?? 0) - (a.row.pct ?? 0))[0];
  const full = fullest?.row.pct ?? 0, th = ctx.settings.thresholds;

  return {
    stats: [
      { k: 'services', v: services ? `${svcRunning} / ${enabled.length}` : '—', level: stopped ? 'warn' : null },
      { k: 'updates', v: updates == null ? '—' : String(updates) },
      { k: 'storage', v: fmtPct(fullest?.row.pct), level: full >= th.storageWarnPct ? 'crit' : full >= th.storageAmberPct ? 'warn' : null }
    ],
    line: [stopped && `${stopped} service${stopped > 1 ? 's' : ''} stopped`, fullest && `${fullest.label} ${fmtPct(fullest.row.pct)} full`, disks.length && `SMART ${good} / ${disks.length} ok`].filter(Boolean).join(' · ') || 'Online',
    alerts,
    storage,
    drives: await omvDrives(w, ctx, disks)
  };
}
