// The widget integrations and the context each collect(w, ctx) receives.
import { request, getJson } from '../http.js';
import * as proxmox from './proxmox.js';
import * as pbs from './pbs.js';
import * as opnsense from './opnsense.js';
import * as fritzbox from './fritzbox.js';
import * as adguard from './adguard.js';
import * as portainer from './portainer.js';
import * as openmediavault from './openmediavault.js';
/** @import { Context, Integration } from '$lib/types' */

/** @type {Record<string, Integration>} */
export const INTEGRATIONS = { proxmox, proxmoxbackupserver: pbs, opnsense, fritzbox, adguard, portainer, openmediavault };
export const ORDER = ['proxmox']; // runs first: provides guest ids for backup freshness

/**
 * ctx for collect(w, ctx). Integrations reach the outside only through it:
 * - request / getJson: the widget HTTP transport, (url, opts) → Response. undici in production,
 *   fixtureTransport (demo/index.js) in the demo and in tests.
 * - kv: durable get/set that survives restarts (SQLite in production, a Map in tests).
 * - state: in-memory per service between polls; shared: hand-offs between integrations.
 * @returns {Context}
 */
export function createContext({ transport = request, kv, settings, now, insecure = true, shared = {}, state = {}, metric = () => {} }) {
  return { settings, now, insecure, shared, state, metric, kv, request: transport, getJson: (url, opts) => getJson(url, opts, transport) };
}
