import type { RequestHandler } from './$types';
import fs from 'node:fs';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { CONFIG_DIR } from '$lib/server/config.ts';

// Serves user-editable files from config/icons and config/images.
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
  let st;
  try { st = fs.statSync(file); } catch { error(404); }
  const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(fs.readFileSync(file), {
    headers: {
      'content-type': TYPES[ext],
      etag,
      // short cache: icons are meant to be swapped by editing the config folder
      'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
      ...(ext === 'svg' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {})
    }
  });
};
