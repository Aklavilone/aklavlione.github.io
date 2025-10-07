/* Service Worker: предкэш + ленивое кеширование изображений из assets/ */

const CACHE_VERSION = 'v1.0.1'; // ▲ обновили версию — это принудительно инвалидирует старый кэш
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const RUNTIME_IMG_CACHE = `img-${CACHE_VERSION}`;

// content.js теперь грузим с версией ?v=2 — добавляем и его в предкэш
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './sw.js',
  './content.js?v=2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => {
        if (k !== STATIC_CACHE && k !== RUNTIME_IMG_CACHE) return caches.delete(k);
      })
    );
    await self.clients.claim();
  })());
});

function isAssetImage(reqUrl) {
  try {
    const url = new URL(reqUrl, self.location.href);
    return url.origin === self.location.origin && url.pathname.includes('/assets/');
  } catch { return false; }
}

self.addEventListener('fetch', event => {
  const { request } = event;

  // SPA навигации
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(STATIC_CACHE);
        cache.put('./index.html', response.clone());
        return response;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match('./index.html');
        return cached || new Response('<!doctype html><title>Offline</title><h1>Offline</h1>', { headers: { 'Content-Type':'text/html' }});
      }
    })());
    return;
  }

  // Изображения из /assets — cache-first
  if (isAssetImage(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_IMG_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const net = await fetch(request, { mode: 'no-cors' });
        cache.put(request, net.clone());
        return net;
      } catch {
        const emptyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8z/CfBwAD2QG0Qm7BbwAAAABJRU5ErkJggg==';
        return fetch(emptyPng);
      }
    })());
    return;
  }

  // Остальные запросы — сначала кэш, потом сеть
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const net = await fetch(request);
      // Кладём мелкие статики
      if (/\.(js|css|webmanifest)($|\?)/.test(request.url)) {
        cache.put(request, net.clone());
      }
      return net;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
