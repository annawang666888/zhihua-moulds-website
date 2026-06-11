/* ========== Service Worker for Zhihua Moulds ========== */
/*
 * Cloudflare Pages launch-safe service worker.
 * Previous versions used a cache-first strategy, which can keep old Netlify-era
 * pages in visitors' browsers. This version clears old caches and always tries
 * the network first for pages/assets, so updates appear immediately.
 */
const CACHE_NAME = 'zhihua-moulds-cloudflare-v2';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});
