// Portainer — X-API-Key, environment id in `env` (same as homepage). The Docker API behind Portainer's proxy;
// containers.ts does the rest, as for the docker widget.
import { trimUrl } from '../http.ts';
import { collectContainers } from './containers.ts';
import type { Context, Widget, WidgetResult } from '$lib/types';

/** `env` is the Portainer environment id; `key` an access token (config requires it for this type). */
type PortainerWidget = Widget & { env?: string | number; key: string };

export function collect(widget: Widget, ctx: Context): Promise<WidgetResult> {
  const w = widget as PortainerWidget;
  return collectContainers(`${trimUrl(w.url)}/api/endpoints/${w.env}/docker`, { headers: { 'X-API-Key': w.key }, insecure: ctx.insecure }, ctx);
}
