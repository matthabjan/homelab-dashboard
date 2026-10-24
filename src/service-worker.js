/// <reference lib="webworker" />
// App-shell caching so the installed app opens instantly; live data always comes from the network.
// Page loads are never intercepted: the browser shows the basic-auth prompt only for its own requests,
// so a 401 answered from here would leave the page at "401 Unauthorized" with no way to log in.
import { build, files, version } from '$service-worker';

const CACHE = `shell-${version}`;
const SHELL = [...build, ...files.filter((f) => !f.endsWith('.txt'))];

self.addEventListener('install', (e) => {
  // one by one and best effort: a 401 (not logged in yet) must not block a new worker from installing
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((f) => c.add(f)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.mode === 'navigate') return;
  if (url.pathname.startsWith('/api/')) return; // live data: network only

  // immutable build assets: cache first
  if (SHELL.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }

  // icons, manifest: network first, fall back to the last copy when offline
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && url.pathname.startsWith('/assets/')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
