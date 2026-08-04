const CACHE = 'bootscout-shell-v1';
const RUNTIME = 'bootscout-runtime-v1';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => ![CACHE, RUNTIME].includes(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(RUNTIME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request)));
    return;
  }

  if (url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.open(RUNTIME).then(cache =>
        cache.match(request).then(hit => {
          const network = fetch(request).then(response => {
            if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
            return response;
          }).catch(() => hit);
          return hit || network;
        })
      )
    );
  }
});
