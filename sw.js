// Работа без интернета: оболочка приложения из кэша, данные — сначала из сети.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = 'data';
const SHELL_FILES = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/core.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const path = url.pathname;
  if (/\/admin\.html$|\/js\/(admin|parser|publish)\.js$/.test(path)) return;

  if (/\/data\/.+\.json$/.test(path)) {
    const key = url.origin + path;
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(DATA).then((c) => c.put(key, copy));
      }
      return res;
    }).catch(async () => {
      const cached = await caches.match(key, { cacheName: DATA });
      if (!cached) throw new Error('offline');
      const headers = new Headers(cached.headers);
      headers.set('X-From-Cache', '1');
      return new Response(await cached.blob(), { status: 200, headers });
    }));
    return;
  }

  // Оболочка: отвечаем из кэша и обновляем его в фоне.
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then((res) => {
      if (res.ok && !/\/data\//.test(path)) c.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
