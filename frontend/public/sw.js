/* Service Worker for OneStat Push Notifications */

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
