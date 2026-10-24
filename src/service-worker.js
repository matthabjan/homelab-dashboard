/// <reference lib="webworker" />
// App-shell caching so the installed app opens instantly; live data always comes from the network.
import { build, files, version } from '$service-worker';

const CACHE = `shell-${version}`;
const SHELL = [...build, ...files.filter((f) => !f.endsWith('.txt'))];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data: network only

  // immutable build assets: cache first
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }

  // pages, icons, manifest: network first, fall back to the last copy when offline
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || url.pathname.startsWith('/assets/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('/') : undefined)))
  );
});
