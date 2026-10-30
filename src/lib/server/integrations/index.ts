// The widget integrations and the context each collect(w, ctx) receives.
import { request, getJson } from '../http.ts';
import * as proxmox from './proxmox.ts';
import * as pbs from './pbs.ts';
import * as opnsense from './opnsense.ts';
import * as fritzbox from './fritzbox.ts';
import * as adguard from './adguard.ts';
import * as portainer from './portainer.ts';
import * as openmediavault from './openmediavault.ts';
import * as docker from './docker.ts';
import * as pihole from './pihole.ts';
import * as customapi from './customapi.ts';
import type { Context, Integration, Kv, RequestOptions, Settings, Shared, Transport } from '$lib/types';

export const INTEGRATIONS: Record<string, Integration> = { proxmox, proxmoxbackupserver: pbs, opnsense, fritzbox, adguard, portainer, openmediavault, docker, pihole, customapi };
export const ORDER = ['proxmox']; // runs first: provides guest ids for backup freshness

/**
 * ctx for collect(w, ctx). Integrations reach the outside only through it:
 * - request / getJson: the widget HTTP transport, (url, opts) → Response. undici in production,
 *   fixtureTransport (demo/index.ts) in the demo and in tests.
 * - kv: durable get/set that survives restarts (SQLite in production, a Map in tests).
 * - state: in-memory per service between polls; shared: hand-offs between integrations.
 */
export function createContext({ transport = request, kv, settings, now, insecure = true, shared = {}, state = {}, metric = () => {} }: {
  transport?: Transport;
  kv: Kv;
  settings: Settings;
  now: number;
  insecure?: boolean;
  shared?: Shared;
  state?: Context['state'];
  metric?: Context['metric'] }): Context {
  return { settings, now, insecure, shared, state, metric, kv, request: transport, getJson: <T>(url: string, opts?: RequestOptions) => getJson(url, opts, transport) as Promise<T> };
}
