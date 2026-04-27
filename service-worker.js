const CACHE_NAME = "glowtrack-static-v8";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./compliance-upgrade.css",
  "./mobile-app.js",
  "./library-upgrade.js",
  "./compliance-upgrade.js",
  "./compliance-hotfix.js",
  "./paste-import-upgrade.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
