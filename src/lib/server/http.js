import { Agent, fetch } from 'undici';
import tls from 'node:tls';
import net from 'node:net';

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false }, keepAliveTimeout: 10_000 });
const secureAgent = new Agent({ keepAliveTimeout: 10_000 });

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

export async function getJson(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) {
    // the response body goes to the server log only — the message is shown to every viewer
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = (await res.text().catch(() => '')).slice(0, 300);
    throw err;
  }
  return res.json();
}

export const basicAuth = (u, p) => 'Basic ' + Buffer.from(`${u ?? ''}:${p ?? ''}`).toString('base64');
export const trimUrl = (u) => String(u || '').replace(/\/+$/, '');

/** HTTP reachability check. Any response below 500 counts as "up" (login pages return 401/403). */
export async function probe(url) {
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
  UND_ERR_SOCKET: 'Socket error'
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
