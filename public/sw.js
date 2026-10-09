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

// Persist only a clicked destination, never a delivered notification or student data.
// iOS can launch the home-screen start URL instead of the requested deep link.
async function rememberReminderClick(relativeUrl) {
  try {
    const url = new URL(relativeUrl, self.location.origin);
    const type = url.searchParams.get('open');
    const date = url.searchParams.get('date');
    if (url.pathname !== '/' || !['sleep', 'caffeine'].includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
    const clickedAt = Date.now();
    const cache = await caches.open('student-reminder-click-v1');
    const key = new URL(`/__reminder-click__/${crypto.randomUUID()}`, self.location.origin);
    await cache.put(key.href, new Response(JSON.stringify({ url: relativeUrl, clickedAt }), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch { /* URL navigation still works if local storage is unavailable. */ }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const relativeUrl = safeRelativeUrl(event.notification.data?.url);
  const targetUrl = new URL(relativeUrl, self.location.origin);
  event.waitUntil((async () => {
    await rememberReminderClick(relativeUrl);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exact = windows.find((client) => {
      try { return new URL(client.url).href === targetUrl.href; } catch { return false; }
    });
    if (exact) {
      try { await exact.focus(); } catch { /* A resumed iOS client can reject focus. */ }
      exact.postMessage?.({ type: 'REMINDER_CLICKED' });
      return;
    }
    const sameOrigin = windows.find((client) => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin && url.pathname === '/';
      } catch { return false; }
    });
    if (sameOrigin && typeof sameOrigin.navigate === 'function') {
      try { await sameOrigin.navigate(targetUrl.href); } catch { /* App reads the saved destination on resume. */ }
      try { await sameOrigin.focus(); } catch { /* Do not abandon the saved click. */ }
      sameOrigin.postMessage?.({ type: 'REMINDER_CLICKED' });
      return;
    }
    await self.clients.openWindow(relativeUrl);
  })());
});

// Cache only the public student shell/assets. Session and health API responses stay network-only.
const STUDENT_SHELL_CACHE = 'student-shell-phone-sync-v6';
const STUDENT_SHELL_FILES = ['/', '/public/data/caffeine-db.json', '/public/js/safe-render.js', '/public/js/read-feedback.js', '/public/js/student-feedback.js', '/public/js/student-sync.js', '/public/js/student-sync-ui.js', '/public/js/api-bridge.js', '/public/js/badge-journey.js', '/public/js/install-guide.js', '/public/js/push-reminders.js', '/public/js/student-startup.js'];
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
