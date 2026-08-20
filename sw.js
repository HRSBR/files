// Service Worker — Meu Plano Diário
// Faz o app funcionar offline após o primeiro acesso

const CACHE_NAME = "meu-plano-v3";
const FILES_TO_CACHE = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

// Instalação — salva os arquivos no cache
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// Ativação — remove caches antigos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — serve do cache quando offline
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).catch(() => caches.match("./index.html"));
    })
  );
});