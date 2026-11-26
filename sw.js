// Работа без интернета: оболочка приложения из кэша, данные — сначала из сети.
const VERSION = 'v25';
const SHELL = `shell-${VERSION}`;
const DATA = 'data';
async function fetchTimed(request, options = {}, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fetch(request, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
const SHELL_FILES = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/core.js', 'js/personal.js', 'manifest.webmanifest',
  'css/winter.css', 'js/winter.js', 'js/winter-physics.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — берём файлы с сервера, а не из HTTP-кэша браузера (иначе новая версия
  // может закэшировать старые файлы).
  e.waitUntil(caches.open(SHELL)
    .then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));

});

// Сохраняем все опубликованные недели, даже если их ещё не открывали на устройстве.
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache-weeks' || !Array.isArray(e.data.ids)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(DATA);
    for (const id of e.data.ids.filter((id) => /^\d{4}-\d{2}-\d{2}$/.test(id))) {
      const url = new URL(`data/weeks/${id}.json`, self.registration.scope);
      try {
        const res = await fetchTimed(url, { cache: 'no-store' }, 8000);
        if (res.ok) await cache.put(url.href, res);
      } catch { /* При следующем подключении повторим. */ }
    }
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const path = url.pathname;
  if (/\/admin\.html$|\/js\/(admin|parser|publish)\.js$/.test(path)) return;

  if (/\/data\/.+\.json$/.test(path)) {
    const key = url.origin + path;
    e.respondWith((async () => {
      try {
        const res = await fetchTimed(e.request);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const cache = await caches.open(DATA);
        await cache.put(key, res.clone());
        return res;
      } catch {
      const cached = await caches.match(key, { cacheName: DATA });
      if (!cached) throw new Error('offline');
      const headers = new Headers(cached.headers);
      headers.set('X-From-Cache', '1');
      return new Response(await cached.blob(), { status: 200, headers });
      }
    })());
    return;
  }

  // Оболочка: отвечаем из кэша и обновляем его в фоне.
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const key = url.origin + path;
    const cached = await c.match(key);
    // no-cache: браузер сверяется с сервером (если файл не менялся — быстрый ответ 304).
    const network = fetch(key, { cache: 'no-cache' }).then((res) => {
      if (res.ok && !/\/data\//.test(path)) c.put(key, res.clone());
      return res;
    });
    if (!cached) return network;
    e.waitUntil(network.catch(() => {}));
    return cached;
  }));
});
