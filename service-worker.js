// HMC Clinic — Service Worker
// Strategy:
//   • HTML / navigation requests → Network-first (so updates show immediately
//     when the user is online). Falls back to cached copy when offline.
//   • Static assets (icons, manifest) → Stale-while-revalidate.
//   • Supabase + CDN requests → Always go to network, never cached (data
//     freshness > offline support; stale data in a clinic app is dangerous).
//
// To force everyone onto a new build: bump CACHE_VERSION below. The next time
// each device opens the app, it will detect the new version and show the
// "🎉 Update available" banner. The user clicks Update → page reloads on the
// new code.
//
// Built from the radiology-app pattern (same flow, proven on production).

const CACHE_VERSION = 'v4'; /* RESTORE V1 2026-06-28: idle auto-logout */
const CACHE_NAME = `hmc-app-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {/* tolerate missing icons */}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const req = event.request;

  // Skip Supabase + CDNs (always go to network — data freshness matters).
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('cdn.') ||
      url.hostname.includes('cdnjs.') ||
      url.hostname.includes('fonts.') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('jsdelivr.net') ||
      url.hostname.includes('unpkg.com')) return;
  if (url.origin !== self.location.origin) return;
  if (req.method !== 'GET') return;

  // Network-first for HTML / navigation (updates appear immediately when online).
  const isHtml = req.mode === 'navigate' ||
                 req.url.endsWith('.html') ||
                 req.url.endsWith('/');
  if (isHtml) {
    event.respondWith(
      fetch(req).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return response;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Stale-while-revalidate for everything else (icons, manifest).
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Messages from the app — used by the "Check for updates" + "Clear cache"
// buttons in Settings, and by the "Update now" banner.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
