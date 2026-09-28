function safeRelativeUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/', self.location.origin);
    if (url.origin !== self.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = {}; }
  const title = typeof payload.title === 'string' ? payload.title : '카페인·수면 기록';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '기록할 내용을 확인해 주세요.',
    tag: typeof payload.tag === 'string' ? payload.tag : 'record-reminder',
    icon: '/public/icons/icon-192.png',
    badge: '/public/icons/icon-192.png',
    data: { url: safeRelativeUrl(payload.data?.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const relativeUrl = safeRelativeUrl(event.notification.data?.url);
  const targetUrl = new URL(relativeUrl, self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exact = windows.find((client) => {
      try { return new URL(client.url).href === targetUrl.href; } catch { return false; }
    });
    if (exact) {
      await exact.focus();
      return;
    }
    const sameOrigin = windows.find((client) => {
      try { return new URL(client.url).origin === self.location.origin; } catch { return false; }
    });
    if (sameOrigin && typeof sameOrigin.navigate === 'function') {
      await sameOrigin.navigate(targetUrl.href);
      await sameOrigin.focus();
      return;
    }
    await self.clients.openWindow(relativeUrl);
  })());
});
