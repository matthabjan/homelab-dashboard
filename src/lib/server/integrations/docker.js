// Docker — the Engine API through a socket proxy (tecnativa/docker-socket-proxy with CONTAINERS=1, INFO=1), no auth.
// Never the socket itself: read access to /var/run/docker.sock is root on the host. containers.js does the rest.
import { trimUrl } from '../http.js';
import { collectContainers } from './containers.js';
/** @import { Context, Widget, WidgetResult } from '$lib/types' */

/** Only a proxy over HTTP: a socket path or unix:// URL is refused (config.js reports it as a config problem too). */
export const dockerUrlOk = (url) => /^https?:\/\//i.test(String(url ?? ''));

/**
 * @param {Widget} w
 * @param {Context} ctx
 * @returns {Promise<WidgetResult>}
 */
export async function collect(w, ctx) {
  if (!dockerUrlOk(w.url)) throw new Error('url must be http(s):// (a socket proxy)');
  return collectContainers(trimUrl(w.url), { insecure: ctx.insecure }, ctx);
}
