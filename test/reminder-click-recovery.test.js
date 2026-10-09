import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createPushReminders } from '../public/js/push-reminders.js';

const origin = 'https://app.example';
const sleepUrl = '/?open=sleep&date=2026-10-09';
function cacheStorage() {
  const buckets = new Map();
  return { async open(name) {
    if (!buckets.has(name)) buckets.set(name, new Map());
    const values = buckets.get(name);
    const key = value => new URL(value.url || value, origin).href;
    return {
      async put(request, response) { values.set(key(request), response.clone()); },
      async match(request) { return values.get(key(request))?.clone(); },
      async keys() { return [...values.keys()].map(url => new Request(url)); },
      async delete(request) { return values.delete(key(request)); },
    };
  } };
}
async function worker(caches, windows = []) {
  const listeners = {}, opened = [];
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, Request, Response, caches, crypto, Date,
    self: { location: { origin }, addEventListener: (name, fn) => { listeners[name] = fn; },
      clients: { matchAll: async () => windows, openWindow: async url => { opened.push(url); return null; } },
    },
  });
  return { opened, async click(url = sleepUrl) {
    let work;
    listeners.notificationclick({ notification: { data: { url }, close() {} }, waitUntil(promise) { work = promise; } });
    await work;
  } };
}
function app(caches, search = '', now = () => Date.now()) {
  const opened = [];
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const controller = createPushReminders({ cachesRef: caches, now,
    locationRef: { origin, pathname: '/', search, hash: '' }, sessionStorageRef: storage,
    detectEnvironment: () => 'unsupported', openRecord: value => opened.push(value),
  });
  return { controller, opened };
}

test('cold iPhone launch recovers a clicked sleep destination when openWindow loses the query', async () => {
  const caches = cacheStorage();
  await (await worker(caches)).click();
  // New page, no URL query and no in-memory worker state.
  const { controller, opened } = app(caches);
  await controller.initialize({ studentId: '0' });
  assert.deepEqual(opened, [{ type: 'sleep', date: '2026-10-09' }]);
  const secondLaunch = app(caches);
  await secondLaunch.controller.initialize({ studentId: '0' });
  assert.equal(secondLaunch.opened.length, 0, 'a handled click must not reopen next launch');
});

test('warm app recovers a click even when iPhone navigate rejects', async () => {
  const caches = cacheStorage(), { controller, opened } = app(caches);
  await controller.initialize({ studentId: '0' });
  const client = { url: origin + '/', navigate: async () => { throw new TypeError('navigate failed'); }, focus: async () => {} };
  await (await worker(caches, [client])).click();
  await controller.resume();
  assert.deepEqual(opened, [{ type: 'sleep', date: '2026-10-09' }]);
  await controller.resume();
  assert.equal(opened.length, 1);
});

test('native notification URL wins over a previous different cached click in either direction', async () => {
  for (const [previous, current] of [['sleep', 'caffeine'], ['caffeine', 'sleep']]) {
    const caches = cacheStorage();
    await (await worker(caches)).click(`/?open=${previous}&date=2026-10-09`);
    // Declarative delivery bypasses the worker, so no new click replaces this cache.
    const { controller, opened } = app(caches, `?open=${current}&date=2026-10-10`);
    await controller.initialize({ studentId: '0' });
    await controller.resume();
    assert.deepEqual(opened, [{ type: current, date: '2026-10-10' }]);
    const later = app(caches);
    await later.controller.initialize({ studentId: '0' });
    assert.deepEqual(later.opened, [], 'the superseded click must be cleared');
  }
});

test('cached click waits for login and URL plus recovery does not open the form twice', async () => {
  const caches = cacheStorage(); await (await worker(caches)).click();
  const { controller, opened } = app(caches, sleepUrl.slice(1));
  await controller.initialize(null);
  assert.equal(opened.length, 0);
  await controller.initialize({ studentId: '0' });
  assert.deepEqual(opened, [{ type: 'sleep', date: '2026-10-09' }]);
  await controller.initialize(null);
  await (await worker(caches)).click('/?open=caffeine&date=2026-10-10');
  await controller.resume();
  assert.equal(opened.length, 1, 'do not open private app tabs after logout');
  await controller.initialize({ studentId: '0' });
  assert.deepEqual(opened[1], { type: 'caffeine', date: '2026-10-10' });
});

test('notification never navigates a teacher window into the student app', async () => {
  const caches = cacheStorage(); let teacherNavigated = false;
  const sw = await worker(caches, [{ url: origin + '/teacher', navigate: async () => { teacherNavigated = true; }, focus: async () => {} }]);
  await sw.click();
  assert.equal(teacherNavigated, false);
  assert.deepEqual(sw.opened, [sleepUrl]);
});

test('recovery ignores external and invalid reminder destinations', async () => {
  const caches = cacheStorage(), sw = await worker(caches);
  await sw.click('https://evil.example/?open=sleep&date=2026-10-09');
  await sw.click('/?open=sleep&date=2026-02-30');
  const { controller, opened } = app(caches);
  await controller.initialize({ studentId: '0' });
  assert.deepEqual(opened, []);
});

test('expired clicks are discarded and cache failure preserves ordinary URL navigation', async () => {
  const caches = cacheStorage(); await (await worker(caches)).click();
  const expired = app(caches, '', () => Date.now() + 60 * 60 * 1000 + 1000);
  await expired.controller.initialize({ studentId: '0' });
  assert.deepEqual(expired.opened, []);
  const next = app(caches); await next.controller.initialize({ studentId: '0' });
  assert.deepEqual(next.opened, [], 'expired clicks must also be removed');
  const unavailable = app({ open: async () => { throw new Error('storage denied'); } }, sleepUrl.slice(1));
  await unavailable.controller.initialize({ studentId: '0' });
  assert.deepEqual(unavailable.opened, [{ type: 'sleep', date: '2026-10-09' }]);
});

test('a new click arriving during recovery is retained for the next resume', async () => {
  const caches = cacheStorage(), sw = await worker(caches);
  await sw.click();
  let newClick = false;
  const overlapping = { async open(name) {
    const cache = await caches.open(name);
    return { ...cache, async match(key) {
      const response = await cache.match(key);
      if (!newClick) { newClick = true; await sw.click('/?open=caffeine&date=2026-10-10'); }
      return response;
    } };
  } };
  const { controller, opened } = app(overlapping);
  await controller.initialize({ studentId: '0' });
  await controller.resume();
  assert.deepEqual(opened, [{ type: 'sleep', date: '2026-10-09' }, { type: 'caffeine', date: '2026-10-10' }]);
});

test('logout during a cache read cancels navigation and leaves the click for authenticated entry', async () => {
  const caches = cacheStorage(), sw = await worker(caches);
  let release, reading;
  const readStarted = new Promise(resolve => { reading = resolve; });
  const readWait = new Promise(resolve => { release = resolve; });
  let pause = false;
  const slow = { async open(name) {
    const cache = await caches.open(name);
    return { ...cache, async match(key) {
      if (pause) { reading(); await readWait; }
      return cache.match(key);
    } };
  } };
  const { controller, opened } = app(slow);
  await controller.initialize({ studentId: '0' });
  await sw.click(); pause = true;
  const pending = controller.resume(); await readStarted;
  await controller.initialize(null); release(); await pending;
  assert.deepEqual(opened, []);
  pause = false; await controller.initialize({ studentId: '0' });
  assert.deepEqual(opened, [{ type: 'sleep', date: '2026-10-09' }]);
});
