/* STAR UP! PWA service worker — GitHub Pages /starup/ */
const CACHE_NAME = 'star-up-pwa-v30-reward-shop-detail';
const BASE = new URL(self.registration.scope);
const CORE_FILES = [
  '',
  'index.html',
  'manifest.webmanifest',
  'manifest-teacher.webmanifest',
  'manifest-student.webmanifest',
  'manifest.json',
  'logo-star-up.jpg',
  'logo-star-up-transparent.png',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'favicon-32.png'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache core files individually so one optional icon cannot block installation.
    await Promise.all(CORE_FILES.map(async url => {
      try {
        const response = await fetch(url, {cache: 'reload'});
        if (response.ok) await cache.put(url, response);
      } catch (error) {
        // A missing optional file should not prevent the PWA from installing.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('star-up-pwa-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(new URL('index.html', BASE).href, response.clone());
        }
        return response;
      } catch (error) {
        return (await caches.match(new URL('index.html', BASE).href)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
