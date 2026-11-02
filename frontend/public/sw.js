/* KeshTune — cache do "casco" do app para abrir sem internet. A API e o áudio nunca são cacheados aqui. */
const CACHE = 'spx-shell-v2';
const BASE = new URL('./', self.location).pathname;

// Guarda o casco e TODOS os arquivos do app (inclusive as telas carregadas sob demanda), para abrir tudo sem internet.
async function precacheAll() {
  const c = await caches.open(CACHE);
  await c.addAll([BASE, `${BASE}icon.svg`, `${BASE}manifest.webmanifest`]);
  const seen = new Set();
  const queue = [];
  const enqueue = (text) => {
    for (const m of text.matchAll(/(?:assets\/|\.\/)([\w.-]+\.(?:js|css))/g)) {
      const url = new URL(`${BASE}assets/${m[1]}`, self.location.origin).href;
      if (!seen.has(url) && seen.size < 400) { seen.add(url); queue.push(url); }
    }
  };
  enqueue(await (await c.match(BASE)).text());
  while (queue.length) {
    const batch = queue.splice(0, 6);
    await Promise.allSettled(batch.map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) return;
      await c.put(u, r.clone());
      if (u.endsWith('.js')) enqueue(await r.text());
    }));
  }
}
self.addEventListener('install', (e) => {
  // não bloqueia a instalação se algum arquivo falhar
  e.waitUntil(precacheAll().catch(() => {}).then(() => self.skipWaiting()));
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
