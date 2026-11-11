import type { RequestHandler } from './$types';
import fs from 'node:fs';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { CONFIG_DIR } from '$lib/server/config.ts';
import { builtinFor } from '$lib/server/default-images.ts';
import icon192 from '$lib/server/default-images/android-chrome-192x192.png?inline';
import icon512 from '$lib/server/default-images/android-chrome-512x512.png?inline';
import appleTouch from '$lib/server/default-images/apple-touch-icon.png?inline';
import favicon from '$lib/server/default-images/favicon.ico?inline';
import logoDark from '$lib/server/default-images/logo-dark.png?inline';
import faviconDark from '$lib/server/default-images/favicon-dark.ico?inline';

// Serves user-editable files from config/icons and config/images, and the app's own icon where the config has none
// (default-images.ts).
const OWN = new Map(
  Object.entries({ 'android-chrome-192x192.png': icon192, 'android-chrome-512x512.png': icon512, 'apple-touch-icon.png': appleTouch, 'favicon.ico': favicon, 'logo-dark.png': logoDark, 'favicon-dark.ico': faviconDark }).map(([name, uri]) => {
    const body = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    return [name, { body, etag: `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"` }];
  })
);
const CACHE = 'public, max-age=300, stale-while-revalidate=86400';
const TYPES: Record<string, string> = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', ico: 'image/x-icon' };

export const GET: RequestHandler = ({ params, request }) => {
  const rel = params.path;
  const [top] = rel.split('/');
  if (!['icons', 'images'].includes(top)) error(404);
  const root = path.join(CONFIG_DIR, top);
  const file = path.resolve(CONFIG_DIR, rel);
  if (!file.startsWith(root + path.sep)) error(404);
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!TYPES[ext]) error(404);
  const own = OWN.get(builtinFor(CONFIG_DIR, rel) ?? '');
  if (own) {
    if (request.headers.get('if-none-match') === own.etag) return new Response(null, { status: 304, headers: { etag: own.etag } });
    return new Response(new Uint8Array(own.body), { headers: { 'content-type': TYPES[ext], etag: own.etag, 'cache-control': CACHE } });
  }
  let st;
  try { st = fs.statSync(file); } catch { error(404); }
  if (!st.isFile()) error(404); // a directory named like an image
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(fs.readFileSync(file), {
    headers: {
      'content-type': TYPES[ext],
      etag,
      // short cache: icons are meant to be swapped by editing the config folder
      'cache-control': CACHE,
      ...(ext === 'svg' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {})
    }
  });
};
