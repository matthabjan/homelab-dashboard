// Portainer — X-API-Key, environment id in `env` (same as homepage). The Docker API behind Portainer's proxy;
// containers.ts does the rest, as for the docker widget.
import { trimUrl } from '../http.ts';
import { collectContainers } from './containers.ts';
import type { Context, Widget, WidgetResult } from '$lib/types';

/** `env` is the Portainer environment id; `key` an access token (config requires it for this type). */
type PortainerWidget = Widget & { env?: string | number; key: string };

/** The environment id Portainer shows in its URLs (#!/1/docker/…); without one the API path would be /endpoints/undefined. */
export const portainerEnvOk = (env: unknown) => /^\d+$/.test(String(env ?? ''));

export async function collect(widget: Widget, ctx: Context): Promise<WidgetResult> {
  const w = widget as PortainerWidget;
  if (!portainerEnvOk(w.env)) throw new Error('env must be the environment id');
  return collectContainers(`${trimUrl(w.url)}/api/endpoints/${w.env}/docker`, { headers: { 'X-API-Key': w.key }, insecure: ctx.insecure }, ctx);
}
