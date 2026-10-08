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

// Cache only the public student shell/assets. Session and health API responses stay network-only.
const STUDENT_SHELL_CACHE = 'student-shell-phone-sync-v1';
const STUDENT_SHELL_FILES = ['/', '/public/js/student-feedback.js', '/public/js/student-sync.js', '/public/js/student-sync-ui.js', '/public/js/api-bridge.js', '/public/js/badge-journey.js', '/public/js/install-guide.js', '/public/js/push-reminders.js', '/public/js/student-startup.js'];
const STUDENT_CDN_FILES = ['https://cdn.tailwindcss.com','https://cdn.jsdelivr.net/npm/chart.js','https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(STUDENT_SHELL_CACHE).then(async cache => { await cache.addAll(STUDENT_SHELL_FILES); await Promise.allSettled(STUDENT_CDN_FILES.map(url => cache.add(new Request(url, {mode:'no-cors'})))); }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('student-shell-') && key !== STUDENT_SHELL_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const local = url.origin === self.location.origin;
  if (local && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/teacher'))) return;
  const shell = local && url.pathname === '/' && request.mode === 'navigate';
  const asset = local && url.pathname.startsWith('/public/');
  const cdn = ['cdn.tailwindcss.com','cdn.jsdelivr.net','cdnjs.cloudflare.com','fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname);
  if (!shell && !asset && !cdn) return;
  event.respondWith((async () => {
    const cache = await caches.open(STUDENT_SHELL_CACHE);
    const key = shell ? '/' : request;
    try {
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(key, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw error;
    }
  })());
});
