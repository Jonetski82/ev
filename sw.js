// Service worker: app shell offline + map tile cache.
const APP_CACHE = 'evlog-app-v6';
const TILE_CACHE = 'evlog-tiles-v1';
const APP_FILES = [
  './', './index.html', './styles.css', './core.js', './wind.js', './i18n.js', './app.js', './roads.js', './roads-worker.js', './manifest.webmanifest',
  './leaflet.js', './leaflet.css', './icon-192.png', './icon-512.png'
];
const TILE_HOSTS = ['julkinen.traficom.fi', 'tile.openstreetmap.org', 'tiles.openseamap.org', 'avoin-karttakuva.maanmittauslaitos.fi'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('evlog-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Map tiles: cache first, then network (and store).
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(e.request, { ignoreVary: true });
        if (hit) return hit;
        try {
          const res = await fetch(e.request);
          if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
          return res;
        } catch (err) {
          return new Response('', { status: 504 });
        }
      })
    );
    return;
  }

  // Fonts: cache first.
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(APP_CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        try { const res = await fetch(e.request); cache.put(e.request, res.clone()); return res; }
        catch (err) { return new Response('', { status: 504 }); }
      })
    );
    return;
  }

  // Road data is stored by the app itself (IndexedDB), not in the cache.
  if (url.origin === self.location.origin && url.pathname.includes('/roads/')) return;

  // App shell: network first (so updates arrive), fall back to cache offline.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' }).then((res) => {
        const copy = res.clone();
        caches.open(APP_CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
  }
});
