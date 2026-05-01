const CACHE_NAME = 'shift4-timer-v2';

const APP_FILES = [
  '/shift4-timer-app/',
  '/shift4-timer-app/index.html',
  '/shift4-timer-app/style.css',
  '/shift4-timer-app/app.js',
  '/shift4-timer-app/manifest.json',
  '/shift4-timer-app/icon-192.png',
  '/shift4-timer-app/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/shift4-timer-app/')))
  );
});
