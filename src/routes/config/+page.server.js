import { getEngine } from '$lib/server/engine.js';
import { buildConfigView } from '$lib/server/config-view.js';

// Read-only view of what the dashboard loaded. Everything in it comes from config-view.js's allowlist.
/** @type {import('./$types').PageServerLoad} */
export function load({ setHeaders }) {
  setHeaders({ 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' });
  return { view: buildConfigView(getEngine()) };
}
