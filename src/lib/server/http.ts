import { Agent, fetch } from 'undici';
import dns from 'node:dns';
import tls from 'node:tls';
import net from 'node:net';
import type { CertInfo, ProbeResult, RequestOptions, Transport } from '$lib/types';

/**
 * `lookup` for connections that caches answers for 5 minutes: without it every probe and widget call resolves its
 * host again, and the burst every 30 s can trip the DNS server's rate limit (AdGuard: 20 queries/s per client).
 * It hands Node all addresses, so a host with IPv4 and IPv6 falls back to the other family when one is unreachable
 * (undici's DNS interceptor alternates between them and failed every other call from Docker without IPv6).
 */
export function cachedLookup(resolve: typeof dns.lookup = dns.lookup, ttl = 300_000): net.LookupFunction {
  const cache: Map<string, { addrs: dns.LookupAddress[]; until: number }> = new Map();
  return (host, opts, cb) => {
    const key = `${host} ${opts.family ?? 0}`;
    const answer = (addrs: dns.LookupAddress[]) => (opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family));
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

export async function request(url: string, { method = 'GET', headers = {}, body, insecure = true, timeout = 10_000, redirect = 'follow' }: RequestOptions = {}) {
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
 */
export async function getJson(url: string, opts: RequestOptions = {}, transport: Transport = request): Promise<unknown> {
  const res = await transport(url, opts);
  if (!res.ok) {
    // the response body goes to the server log only — the message is shown to every viewer
    const err = (new Error(`HTTP ${res.status}`) as Error & { status?: number; body?: string });
    err.status = res.status;
    err.body = (await res.text().catch(() => '')).slice(0, 300);
    throw err;
  }
  return res.json();
}

export const basicAuth = (u: string | undefined, p: string | undefined) => 'Basic ' + Buffer.from(`${u ?? ''}:${p ?? ''}`).toString('base64');
export const trimUrl = (u: unknown) => String(u || '').replace(/\/+$/, '');

/**
 * TCP reachability: connected within 8 s is up, the time to connect is the latency. `connect` is the seam for tests.
 */
export function tcpProbe(host: string, port: number, { connect = net.connect, timeout = 8000 } = {}): Promise<ProbeResult> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (r: ProbeResult) => { sock.destroy(); resolve(r); };
    sock.setTimeout(timeout, () => done({ ok: false, ms: null, code: 'ETIMEDOUT' }));
    sock.once('connect', () => done({ ok: true, ms: performance.now() - t0, code: 'open' }));
    sock.once('error', (e: NodeJS.ErrnoException) => done({ ok: false, ms: null, code: e?.code || 'ERROR' }));
  });
}

/**
 * Reachability check for a `siteMonitor`: `tcp://host:port` connects, anything else is an HTTP request where
 * any response below 500 counts as "up" (login pages return 401/403).
 */
export async function probe(url: string): Promise<ProbeResult> {
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
    const err = e as (Error & { cause?: { code?: string } }) | undefined;
    const code = err?.cause?.code || err?.name || 'ERROR';
    return { ok: false, ms: null, code };
  }
}

const REASONS: Record<string, string> = {
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
export const reasonText = (code: string | number | null | undefined): string => (typeof code === 'number' ? `HTTP ${code}` : (code && REASONS[code]) || code || 'Unreachable');

/** Reads the TLS certificate of an https URL. */
export function certInfo(url: string): Promise<CertInfo | null> {
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
