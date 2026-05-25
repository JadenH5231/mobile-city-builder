// Service worker (Alpha 4.7) — minimal cache-then-network strategy
// so the game keeps running offline once the player has loaded it
// once. Versioned cache name so a new build invalidates the old one.
// Skips hashed Vite asset URLs (they're immutable; standard cache
// rules apply). Indexed-DB save data is untouched by the SW.

const CACHE = 'mq-city-v19';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './mansion-icon.svg',
  './mansion-icon-maskable.svg',
  // Legal pages (Beta 1.1.5) — cached so account-deletion, terms, and
  // privacy disclosures stay reachable offline. Important for
  // GDPR/CCPA: users must be able to read the policy any time.
  './privacy.html',
  './terms.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GETs from same origin.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Network-first for the HTML shell so the player gets fresh JS bundles
  // when online; cache fallback when offline. Offline fallback first
  // tries the exact request (so /privacy.html and /terms.html stay
  // reachable), then falls back to the SPA shell at index.html.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((hit) => hit || caches.match('./index.html'))
      )
    );
    return;
  }
  // Cache-first for everything else (assets, icons, manifest).
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // Stash a copy for next time. Avoid caching opaque / error responses.
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});
