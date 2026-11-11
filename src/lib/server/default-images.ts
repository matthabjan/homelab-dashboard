// The app's own icon. Its files ship with the app (default-images/) and are served under /assets/images/, where a
// config's images always were, so links, manifests and reverse-proxy rules keep working. A file of the same name in
// CONFIG_DIR/images replaces one, unless it is a copy of the icon earlier versions put there: those installs get the
// current icon without touching their config.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** The files the app has of its own: the icon in its sizes, and the mark alone for dark surfaces. */
export const BUILTIN = ['android-chrome-192x192.png', 'android-chrome-512x512.png', 'apple-touch-icon.png', 'favicon.ico', 'logo-dark.png', 'favicon-dark.ico'];

/** sha256 of the icon files config.starter and config.example shipped before the icon moved into the app */
const STOCK = new Set([
  'ed4e577620d0b1bd7c95d6543769dcc8706c6bf59d92068139dbd7c26610a746',
  'eee58fca23fe06896ba8b57014a0e9aa56e317d3d1023d37fcbced7cde5e7619',
  '91b7c1d7a9697cb8a0cfb5f8f5400c53233a6e292498ccd947c275279b9dc91c',
  '000ba0374e11500bca22a3431de9707ca294b97f5aba28fc787c3969a72cbbbc',
  'ff6ba5a94d24865ad33bf342fe354ee6a5775610bb0a9d68a9dc0c3eb7f35ce6',
  'f1949fe5d3a1831bfbbce82c9e91be629a6d779a4632ecd38e48999b5f28cf38'
]);

// a file is hashed once per size and modification time
const seen = new Map<string, { key: string; stock: boolean }>();

/**
 * The app's own file that answers for `rel` (a path inside the config folder, such as "images/favicon.ico"), or null
 * when the config's file does: one that exists there and is not an old stock icon.
 */
export function builtinFor(configDir: string, rel: string | null | undefined, stock: ReadonlySet<string> = STOCK): string | null {
  const name = /^\/*images\/([^/]+)$/.exec(rel ?? '')?.[1];
  if (!name || !BUILTIN.includes(name)) return null;
  const file = path.join(configDir, 'images', name);
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return name; }
  if (!st.isFile()) return name;
  const key = `${st.size}-${st.mtimeMs}`;
  let known = stock === STOCK ? seen.get(file) : undefined;
  if (known?.key !== key) {
    known = { key, stock: stock.has(createHash('sha256').update(fs.readFileSync(file)).digest('hex')) };
    if (stock === STOCK) seen.set(file, known);
  }
  return known.stock ? name : null;
}
