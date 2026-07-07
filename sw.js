const CACHE_NAME = 'riego-pwa-v3';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    // Archivos propios (html/css/js/manifest/iconos): red primero, para que
    // cualquier actualizacion que subas se vea de inmediato. Si no hay
    // conexion, se sirve la ultima copia buena que haya en cache.
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match(req))
    );
  } else {
    // Recursos externos (fuentes, Font Awesome, SheetJS): cache primero,
    // ya que casi no cambian y asi tambien funcionan sin conexion.
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((resp) => {
          const isCacheable = resp && (resp.ok || resp.type === 'opaque');
          if (isCacheable) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return resp;
        });
      })
    );
  }
});
