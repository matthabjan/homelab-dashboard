// Vitals of the machine the dashboard runs on, from /proc and statfs: the System panel without a Proxmox widget.
// In Docker these are the host's (a container shares the host's /proc/stat and /proc/meminfo); under lxcfs
// (Proxmox LXC) they are the container's own, which is why `host.source: auto` prefers a Proxmox widget.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fmtDuration, fmtPair, pct } from './format.js';
/** @import { Config, HostVitals, Service, Settings } from '$lib/types' */

const PROC = process.env.PROC_DIR || '/proc';

const read = (file) => fs.readFile(file, 'utf8').catch(() => null);

/**
 * The Proxmox service whose node is the host: `host.service` by name, else the first `proxmox` widget.
 * @param {Config} cfg @returns {Service | undefined}
 */
export function hostService(cfg) {
  const want = cfg.settings.host.service;
  return cfg.services.find((s) => (want ? s.name === want : s.widget?.type === 'proxmox'));
}

/** `host.source` resolved: `auto` is Proxmox when there is a Proxmox host service, else local. @param {Config} cfg */
export const hostSource = (cfg) => {
  const src = cfg.settings.host.source;
  return src === 'proxmox' || src === 'local' ? src : hostService(cfg) ? 'proxmox' : 'local';
};

/** Shown as Node: `host.name`, else HOST_NAME (a container's own hostname is its id). @param {Settings['host']} host */
export const localName = (host) => host.name || process.env.HOST_NAME || 'this host';

/** `user nice system idle iowait irq softirq steal` of the aggregate `cpu` line; guest time is already in user. */
function cpuTimes(stat) {
  const f = stat?.match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
  if (!f || f.length < 4 || f.some((x) => !Number.isFinite(x))) return null;
  return { total: f.reduce((a, b) => a + b, 0), idle: f[3] + (f[4] ?? 0) };
}

const kib = (meminfo, key) => {
  const v = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1];
  return v == null ? null : Number(v) * 1024;
};

/** Busy % since the previous call's totals (kept in `state`); null on the first call. */
function cpuPercent(stat, state) {
  const now = cpuTimes(stat);
  const prev = state.prev;
  state.prev = now;
  const dt = now && prev ? now.total - prev.total : 0;
  return now && prev && dt > 0 ? Math.max(0, Math.min(100, (1 - (now.idle - prev.idle) / dt) * 100)) : null;
}

/** @param {string} dir @returns {Promise<HostVitals['disk']>} */
async function diskUsage(dir) {
  try {
    const s = await fs.statfs(dir);
    // like df: used out of what an unprivileged user can fill (root's reserved blocks don't count)
    const used = (s.blocks - s.bfree) * s.bsize;
    return { name: dir, pct: pct(used, used + s.bavail * s.bsize), sub: fmtPair(used, s.blocks * s.bsize) };
  } catch {
    return { name: dir, pct: null, sub: 'unavailable' }; // path not mounted
  }
}

/**
 * Read the local host's vitals. CPU % is the change since the previous call, whose totals are kept in `state`,
 * so the first call has `cpu: null`. Null when /proc/meminfo can't be read (not Linux).
 * @param {Settings['host']} host
 * @param {{ prev?: { total: number, idle: number } | null }} state
 * @param {{ procDir?: string }} [opts]
 * @returns {Promise<HostVitals | null>}
 */
export async function readLocal(host, state, { procDir = PROC } = {}) {
  const [meminfo, stat, uptime, cpuinfo] = await Promise.all(['meminfo', 'stat', 'uptime', 'cpuinfo'].map((f) => read(path.join(procDir, f))));
  if (!meminfo) return null;
  const total = kib(meminfo, 'MemTotal');
  const avail = kib(meminfo, 'MemAvailable') ?? kib(meminfo, 'MemFree');
  if (!total || avail == null) return null;

  const threads = cpuinfo?.match(/^processor\s*:/gm)?.length || os.availableParallelism();
  const up = Number(uptime?.split(/\s/)[0]);
  const mem = total - avail;
  return {
    node: localName(host),
    cpu: cpuPercent(stat, state),
    cpus: threads,
    mem,
    maxmem: total,
    memPct: /** @type {number} */ (pct(mem, total)),
    disk: await diskUsage(host.disk),
    uptime: up > 0 ? fmtDuration(up * 1000) : null,
    guestsRunning: null,
    guestsTotal: null,
    updates: null
  };
}
