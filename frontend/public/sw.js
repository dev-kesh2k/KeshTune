/* Spotify X — cache do "casco" do app para abrir sem internet. A API e o áudio nunca são cacheados aqui. */
const CACHE = 'spx-shell-v1';
const BASE = new URL('./', self.location).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, `${BASE}icon.svg`, `${BASE}manifest.webmanifest`])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE) || url.pathname.startsWith(`${BASE}api/`)) return;
  if (req.mode === 'navigate') {
    // rede primeiro; sem rede, o index.html guardado
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(BASE, copy));
          return r;
        })
        .catch(() => caches.match(BASE))
    );
    return;
  }
  if (url.pathname.startsWith(`${BASE}assets/`) || /\.(svg|png|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((r) => {
            if (r.ok) {
              const copy = r.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return r;
          })
      )
    );
  }
});
