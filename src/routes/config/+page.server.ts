import type { PageServerLoad } from './$types';
import { getEngine } from '$lib/server/engine.ts';
import { buildConfigView } from '$lib/server/config-view.ts';

// Read-only view of what the dashboard loaded. Everything in it comes from config-view.ts's allowlist.
export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
  const engine = getEngine();
  const snap = engine.snapshot;
  // what the shared header and tab bar show; all of it is on the dashboard for every viewer already
  const shell = { logo: snap?.logo ?? null, logoDark: snap?.logoDark ?? null, deepLink: snap?.deepLink ?? null, linkTarget: snap?.linkTarget ?? '_blank', needCount: snap?.needCount ?? 0, level: snap?.verdict.level ?? 'ok' };
  return { view: buildConfigView(engine), shell };
};
