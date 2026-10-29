// Portainer — X-API-Key, environment id in `env` (same as homepage). The Docker API behind Portainer's proxy;
// containers.js does the rest, as for the docker widget.
import { trimUrl } from '../http.js';
import { collectContainers } from './containers.js';
/** @import { Context, Widget, WidgetResult } from '$lib/types' */

/**
 * @param {Widget} w
 * @param {Context} ctx
 * @returns {Promise<WidgetResult>}
 */
export function collect(w, ctx) {
  return collectContainers(`${trimUrl(w.url)}/api/endpoints/${w.env}/docker`, { headers: { 'X-API-Key': w.key }, insecure: ctx.insecure }, ctx);
}
