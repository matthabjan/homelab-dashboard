import { Agent, fetch } from 'undici';
import dns from 'node:dns';
import tls from 'node:tls';
import net from 'node:net';
/** @import { RequestOptions, Transport } from '$lib/types' */

/**
 * `lookup` for connections that caches answers for 5 minutes: without it every probe and widget call resolves its
 * host again, and the burst every 30 s can trip the DNS server's rate limit (AdGuard: 20 queries/s per client).
 * It hands Node all addresses, so a host with IPv4 and IPv6 falls back to the other family when one is unreachable
 * (undici's DNS interceptor alternates between them and failed every other call from Docker without IPv6).
 * @param {typeof dns.lookup} [resolve]
 * @returns {net.LookupFunction}
 */
export function cachedLookup(resolve = dns.lookup, ttl = 300_000) {
  /** @type {Map<string, { addrs: dns.LookupAddress[], until: number }>} */
  const cache = new Map();
  return (host, opts, cb) => {
    const key = `${host} ${opts.family ?? 0}`;
    const answer = (/** @type {dns.LookupAddress[]} */ addrs) => (opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family));
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return answer(hit.addrs);
    resolve(host, { ...opts, all: true }, (err, addrs) => {
      if (err) return cb(err, '', 0);
      cache.set(key, { addrs, until: Date.now() + ttl });
      answer(addrs);
    });
  };
}

const lookup = cachedLookup();
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false, lookup }, keepAliveTimeout: 10_000 });
const secureAgent = new Agent({ connect: { lookup }, keepAliveTimeout: 10_000 });

/** @type {Transport} */
export async function request(url, { method = 'GET', headers = {}, body, insecure = true, timeout = 10_000, redirect = 'follow' } = {}) {
  return fetch(url, {
    method,
    headers,
    body,
    redirect,
    dispatcher: insecure ? insecureAgent : secureAgent,
    signal: AbortSignal.timeout(timeout)
  });
}

/**
 * JSON from any transport with request()'s shape (integrations get theirs bound as ctx.getJson).
 * @param {string} url
 * @param {RequestOptions} [opts]
 * @param {Transport} [transport]
 */
export async function getJson(url, opts = {}, transport = request) {
  const res = await transport(url, opts);
  if (!res.ok) {
    // the response body goes to the server log only — the message is shown to every viewer
    const err = /** @type {Error & { status?: number, body?: string }} */ (new Error(`HTTP ${res.status}`));
    err.status = res.status;
    err.body = (await res.text().catch(() => '')).slice(0, 300);
    throw err;
  }
  return res.json();
}

export const basicAuth = (u, p) => 'Basic ' + Buffer.from(`${u ?? ''}:${p ?? ''}`).toString('base64');
export const trimUrl = (u) => String(u || '').replace(/\/+$/, '');

/**
 * TCP reachability: connected within 8 s is up, the time to connect is the latency. `connect` is the seam for tests.
 * @param {string} host @param {number} port
 * @returns {Promise<{ ok: boolean, ms: number | null, code: string | number }>}
 */
export function tcpProbe(host, port, { connect = net.connect, timeout = 8000 } = {}) {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (r) => { sock.destroy(); resolve(r); };
    sock.setTimeout(timeout, () => done({ ok: false, ms: null, code: 'ETIMEDOUT' }));
    sock.once('connect', () => done({ ok: true, ms: performance.now() - t0, code: 'open' }));
    sock.once('error', (/** @type {NodeJS.ErrnoException} */ e) => done({ ok: false, ms: null, code: e?.code || 'ERROR' }));
  });
}

/**
 * Reachability check for a `siteMonitor`: `tcp://host:port` connects, anything else is an HTTP request where
 * any response below 500 counts as "up" (login pages return 401/403).
 */
export async function probe(url) {
  if (/^tcp:\/\//i.test(url)) {
    let u;
    try { u = new URL(url); } catch { return { ok: false, ms: null, code: 'Bad tcp:// URL' }; }
    if (!u.port) return { ok: false, ms: null, code: 'tcp:// needs a port' };
    return tcpProbe(u.hostname.replace(/^\[|\]$/g, ''), Number(u.port));
  }
  const t0 = performance.now();
  try {
    const res = await request(url, { insecure: true, timeout: 8000, redirect: 'manual' });
    await res.body?.cancel?.().catch(() => {});
    const ms = performance.now() - t0;
    return { ok: res.status < 500, ms, code: res.status };
  } catch (e) {
    const code = e?.cause?.code || e?.name || 'ERROR';
    return { ok: false, ms: null, code };
  }
}

const REASONS = {
  ECONNREFUSED: 'Connection refused',
  ENOTFOUND: 'Host not found',
  EHOSTUNREACH: 'Host unreachable',
  ENETUNREACH: 'Network unreachable',
  ETIMEDOUT: 'Timed out',
  TimeoutError: 'Timed out',
  UND_ERR_CONNECT_TIMEOUT: 'Connect timeout',
  ECONNRESET: 'Connection reset',
  UND_ERR_SOCKET: 'Socket error',
  EAI_AGAIN: 'DNS lookup failed'
};
export const reasonText = (code) => (typeof code === 'number' ? `HTTP ${code}` : REASONS[code] || code || 'Unreachable');

/** Reads the TLS certificate of an https URL. */
export function certInfo(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { return resolve(null); }
    if (u.protocol !== 'https:') return resolve(null);
    const host = u.hostname;
    const sock = tls.connect(
      { host, port: Number(u.port) || 443, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: 6000 },
      () => {
        const c = sock.getPeerCertificate();
        const err = sock.authorizationError ? String(sock.authorizationError) : null;
        sock.end();
        if (!c || !c.valid_to) return resolve(null);
        resolve({
          validTo: new Date(c.valid_to).getTime(),
          trusted: sock.authorized,
          selfSigned: err === 'DEPTH_ZERO_SELF_SIGNED_CERT' || err === 'SELF_SIGNED_CERT_IN_CHAIN',
          subject: c.subject?.CN || host
        });
      }
    );
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}
