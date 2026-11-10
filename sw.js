const CACHE_NAME = 'ai-council-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Forzar la activación inmediata
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Estrategia Network First (Intenta buscar en internet, si falla, usa el caché)
self.addEventListener('fetch', (event) => {
  // Ignorar peticiones a la API de Vercel o extensiones del navegador
  if (event.request.url.includes('/api/chat') || !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Si la respuesta es buena, la guardamos en caché
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Si falla el internet, buscamos en el caché
        return caches.match(event.request);
      })
  );
});
