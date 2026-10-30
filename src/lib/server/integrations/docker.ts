// Docker — the Engine API through a socket proxy (tecnativa/docker-socket-proxy with CONTAINERS=1, INFO=1), no auth.
// Never the socket itself: read access to /var/run/docker.sock is root on the host. containers.ts does the rest.
import { trimUrl } from '../http.ts';
import { collectContainers } from './containers.ts';
import type { Context, Widget, WidgetResult } from '$lib/types';

/** Only a proxy over HTTP: a socket path or unix:// URL is refused (config.ts reports it as a config problem too). */
export const dockerUrlOk = (url: unknown) => /^https?:\/\//i.test(String(url ?? ''));

export async function collect(w: Widget, ctx: Context): Promise<WidgetResult> {
  if (!dockerUrlOk(w.url)) throw new Error('url must be http(s):// (a socket proxy)');
  return collectContainers(trimUrl(w.url), { insecure: ctx.insecure }, ctx);
}
