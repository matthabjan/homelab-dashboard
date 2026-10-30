import type { PageServerLoad } from './$types';
import { getEngine } from '$lib/server/engine.ts';
import { buildConfigView } from '$lib/server/config-view.ts';

// Read-only view of what the dashboard loaded. Everything in it comes from config-view.ts's allowlist.
export const load: PageServerLoad = ({ setHeaders }) => {
  setHeaders({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
  return { view: buildConfigView(getEngine()) };
};
