// Service worker minimal : rend l'application installable et garde une copie de secours des pages.
// Réseau d'abord : les mises à jour du site s'appliquent immédiatement.
const CACHE = 'zt-v1';
const SHELL = ['./admin.html', './admin.js', './lib.js', './ui.js', './style.css', './firebase-config.js', './manifest.json', './icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))) // un fichier absent n'empêche pas l'installation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return; // Firebase et Google ne sont jamais mis en cache
  e.respondWith(
    fetch(r)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); return res; })
      .catch(() => caches.match(r))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return clients.openWindow('./admin.html');
    })
  );
});
