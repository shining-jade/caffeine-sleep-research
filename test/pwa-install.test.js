import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import * as installGuideModule from '../public/js/install-guide.js';

const { detectInstallEnvironment } = installGuideModule;

const root = new URL('../', import.meta.url);

test('manifest declares a standalone Korean app with required same-origin icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('public/manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.name, '카페인·수면 기록');
  const icons = new Map(manifest.icons.map((icon) => [icon.sizes, icon]));
  assert.equal(icons.get('192x192').src, '/public/icons/icon-192.png');
  assert.equal(icons.get('512x512').src, '/public/icons/icon-512.png');
  assert.match(icons.get('512x512').purpose, /maskable/);
  for (const path of ['public/icons/icon.svg', 'public/icons/icon-192.png', 'public/icons/icon-512.png', 'public/icons/apple-touch-icon.png']) {
    const value = await readFile(new URL(path, root));
    assert.ok(value.length > 100);
  }
});

test('Vercel permits the service worker under public to control the root scope', async () => {
  const config = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
  const workerHeaders = config.headers.find(({ source }) => source === '/public/sw.js');
  assert.ok(workerHeaders);
  assert.equal(
    workerHeaders.headers.find(({ key }) => key.toLowerCase() === 'service-worker-allowed')?.value,
    '/',
  );
});

test('install environment detection handles installed iOS Chrome Samsung Naver and fallback', () => {
  assert.equal(detectInstallEnvironment({ userAgent: 'anything', standalone: true, displayMode: false }), 'installed');
  assert.equal(detectInstallEnvironment({ userAgent: 'Mozilla/5.0 (iPhone) Version/18 Mobile Safari/604.1', standalone: false, displayMode: false }), 'ios-safari');
  assert.equal(detectInstallEnvironment({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile Safari/537.36', standalone: false, displayMode: false }), 'android-chrome');
  assert.equal(detectInstallEnvironment({ userAgent: 'Mozilla/5.0 (Linux; Android 14) SamsungBrowser/28.0 Chrome/130 Mobile', standalone: false, displayMode: false }), 'samsung');
  assert.equal(detectInstallEnvironment({ userAgent: 'Mozilla/5.0 (Linux; Android 14) NAVER(inapp; search; 2000)', standalone: false, displayMode: false }), 'naver');
  assert.equal(detectInstallEnvironment({ userAgent: 'Desktop Firefox', standalone: false, displayMode: false }), 'unsupported');
});

test('install guide renders a distinct recognizable browser interface for every supported mobile browser', () => {
  assert.equal(typeof installGuideModule.buildInstallGuideMarkup, 'function');
  const expected = {
    'ios-safari': ['data-browser-ui="safari"', 'Safari 도구 막대', '공유', '홈 화면에 추가'],
    'android-chrome': ['data-browser-ui="chrome"', 'Chrome 메뉴', '⋮', '앱 설치'],
    samsung: ['data-browser-ui="samsung"', '삼성 인터넷 메뉴', '☰', '현재 페이지 추가', '홈 화면'],
    naver: ['data-browser-ui="naver"', '네이버 앱 메뉴', '다른 브라우저로 열기', 'Safari', 'Chrome'],
  };
  const outputs = Object.entries(expected).map(([environment, visibleCues]) => {
    const markup = installGuideModule.buildInstallGuideMarkup(environment);
    for (const cue of visibleCues) assert.match(markup, new RegExp(cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return markup;
  });
  assert.equal(new Set(outputs).size, 4);
});

test('install guide browser mockups include the approved notification setup step', () => {
  assert.equal(typeof installGuideModule.buildInstallGuideMarkup, 'function');
  for (const environment of ['ios-safari', 'android-chrome', 'samsung']) {
    const markup = installGuideModule.buildInstallGuideMarkup(environment);
    assert.match(markup, /알림 켜기/);
    assert.match(markup, /허용/);
  }
  assert.match(installGuideModule.buildInstallGuideMarkup('naver'), /설치·알림 기능이 제한/);
});

test('service worker shows push payload and focuses a matching same-origin deep link', async () => {
  const source = await readFile(new URL('public/sw.js', root), 'utf8');
  const listeners = {};
  const shown = [];
  const focused = [];
  const context = {
    URL,
    self: {
      location: { origin: 'https://app.example' },
      registration: { showNotification: async (...args) => { shown.push(args); } },
      addEventListener(type, listener) { listeners[type] = listener; },
      clients: {
        matchAll: async () => [{
          url: 'https://app.example/?open=sleep&date=2026-09-09',
          focus: async () => { focused.push('existing'); },
          navigate: async () => { throw new Error('must not navigate matching window'); },
        }],
        openWindow: async () => { throw new Error('must not open a second window'); },
      },
    },
  };
  vm.runInNewContext(source, context);
  let pushWork;
  listeners.push({
    data: { json: () => ({ title: '제목', body: '본문', tag: 'tag', data: { url: '/?open=sleep&date=2026-09-09' } }) },
    waitUntil(value) { pushWork = value; },
  });
  await pushWork;
  assert.deepEqual(shown[0][0], '제목');
  assert.equal(shown[0][1].data.url, '/?open=sleep&date=2026-09-09');

  let clickWork;
  listeners.notificationclick({
    notification: { data: { url: '/?open=sleep&date=2026-09-09' }, close() {} },
    waitUntil(value) { clickWork = value; },
  });
  await clickWork;
  assert.deepEqual(focused, ['existing']);
});

test('service worker rejects cross-origin click URLs and opens a safe same-origin fallback', async () => {
  const source = await readFile(new URL('public/sw.js', root), 'utf8');
  const listeners = {};
  const opened = [];
  const context = {
    URL,
    self: {
      location: { origin: 'https://app.example' },
      registration: { showNotification: async () => {} },
      addEventListener(type, listener) { listeners[type] = listener; },
      clients: {
        matchAll: async () => [],
        openWindow: async (url) => { opened.push(url); },
      },
    },
  };
  vm.runInNewContext(source, context);
  let work;
  listeners.notificationclick({
    notification: { data: { url: 'https://evil.example/steal' }, close() {} },
    waitUntil(value) { work = value; },
  });
  await work;
  assert.deepEqual(opened, ['/']);
});
