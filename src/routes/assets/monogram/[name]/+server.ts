import type { RequestHandler } from './$types';

// Generated icon for services without a logo: rounded square with initials.
export const GET: RequestHandler = ({ params }) => {
  const name = decodeURIComponent(params.name).replace(/\.svg$/, '');
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ENTITIES[c]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="hsl(${h} 70% 48%)"/><text x="32" y="41" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="24" font-weight="700" fill="#fff">${esc(initials)}</text></svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
};
