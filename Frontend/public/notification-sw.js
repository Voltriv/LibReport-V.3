self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePushData(data) {
  if (!data) return {};
  try {
    return data.json();
  } catch (err) {
    try {
      return JSON.parse(data.text());
    } catch (parseErr) {
      return {};
    }
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePushData(event.data);
  const title = payload.title || 'LibReport Library';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/logo192.png',
    badge: payload.badge || '/logo192.png',
    tag: payload.tag || `lr-${Date.now()}`,
    data: payload.data || {}
  };

  event.waitUntil(
    (async () => {
      try {
        if (title) {
          await self.registration.showNotification(title, options);
        }
      } catch (err) {
        console.error('[push] Failed to show notification:', err);
      }

      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        try {
          client.postMessage({ type: 'LIBREPORT_PUSH', payload });
        } catch (err) {
          console.error('[push] Failed to post message to client:', err);
        }
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/student/account';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

