// Recorded-style API responses per widget type, served through the same transport seam the
// integrations use in production. The demo and the tests run the real integration code on them.
import proxmox from './proxmox.js';
import proxmoxbackupserver from './proxmoxbackupserver.js';
import opnsense from './opnsense.js';
import fritzbox from './fritzbox.js';
import adguard from './adguard.js';
import portainer from './portainer.js';
import openmediavault from './openmediavault.js';
import docker from './docker.js';
import pihole from './pihole.js';

/** @import { Fixtures, Transport } from '$lib/types' */

export const FIXTURES = { proxmox, proxmoxbackupserver, opnsense, fritzbox, adguard, portainer, openmediavault, docker, pihole };

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A transport with request()'s shape that answers from a fixture table instead of the network.
 * Keys are "METHOD /path" (query string ignored; ":name" matches one segment). Values are functions of
 * { now, scenario, params, headers, body, url } returning an object (sent as JSON) or a string (sent as XML).
 * Unknown routes answer 404, like a real API would.
 * @param {Fixtures} table
 * @param {{ scenario?: string, now?: number }} [opts]
 * @returns {Transport}
 */
export function fixtureTransport(table, { scenario = 'issues', now } = {}) {
  const routes = Object.entries(table).map(([key, fn]) => {
    const [method, pattern] = key.split(' ');
    const names = [];
    const re = new RegExp('^' + escape(pattern).replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$');
    return { method, re, names, fn };
  });
  return async (url, { method = 'GET', headers = {}, body } = {}) => {
    const u = new URL(url);
    for (const r of routes) {
      const m = r.method === method && u.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      let parsed = body;
      try { parsed = JSON.parse(body ?? ''); } catch { /* not JSON: SOAP */ }
      const out = await r.fn({ now: now ?? Date.now(), scenario, params, headers, body: parsed, url: u });
      return typeof out === 'string' ? new Response(out, { headers: { 'Content-Type': 'text/xml' } }) : Response.json(out);
    }
    return new Response('no fixture for this route', { status: 404 });
  };
}
