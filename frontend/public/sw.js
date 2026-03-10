/* Service Worker for OneStat — Push Notifications + Offline Asset Caching */

const CACHE_NAME = 'onestat-v1';

// ── Asset Caching (app shell loads offline) ──────────────────────────────

// Cache static assets on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pre-cache the app shell — these are critical for offline loading
      return cache.addAll([
        '/',
        '/index.html',
        '/pitch-svg.svg',
        '/oneStatLogoTransparent.png',
        '/manifest.json',
      ]).catch(() => {
        // Non-fatal — some assets may not exist yet
        console.log('[SW] Pre-cache partially failed — non-critical');
      });
    })
  );
  self.skipWaiting();
});

// Clean up old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch Strategy ──────────────────────────────────────────────────────
//
// Navigation requests (HTML): Network-first, fall back to cached /index.html (SPA)
// API requests (/api/v1/*): Network-only (offline handling is in IndexedDB outbox)
// Static assets (JS/CSS/images): Cache-first for speed, network fallback
//

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST/PUT/DELETE go to offline outbox, not SW)
  if (event.request.method !== 'GET') return;

  // Skip API requests — IndexedDB outbox handles offline mutations
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests — serve cached /index.html as SPA fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/index.html').then((cached) => cached || fetch(event.request))
      )
    );
    return;
  }

  // Static assets — cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Serve from cache immediately, update cache in background
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached);
        // Return cached version immediately (stale-while-revalidate)
        return cached;
      }
      // Not in cache — fetch and cache
      return fetch(event.request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ── Background Sync ─────────────────────────────────────────────────────
// When the app enqueues items while offline, it can register a sync event.
// The SW fires this when connectivity returns, even if the app is backgrounded.

self.addEventListener('sync', (event) => {
  if (event.tag === 'outbox-sync') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SYNC_OUTBOX' });
        });
      })
    );
  }
});

// ── Push Notifications ──────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'OneStat', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/oneStatLogoTransparent.png',
    badge: '/oneStatLogoTransparent.png',
    tag: payload.tag || 'default',
    data: payload.data || {},
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'View' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'OneStat', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let url = '/player';

  if (data.match_id) {
    url = '/player/stats';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
