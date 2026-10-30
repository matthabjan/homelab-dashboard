import type { RequestHandler } from './$types';
import { getEngine } from '$lib/server/engine.ts';
import { assetUrl } from '$lib/server/config.ts';

export const GET: RequestHandler = () => {
  const { settings } = getEngine().cfg;
  const p = settings.pwa;
  const manifest = {
    name: p.name || settings.title,
    short_name: p.shortName || settings.title,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: p.background,
    theme_color: p.background,
    icons: [
      { src: assetUrl(p.icon192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: assetUrl(p.icon512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: assetUrl(p.icon512), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-cache' } });
};
