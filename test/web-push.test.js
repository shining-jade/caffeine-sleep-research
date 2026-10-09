import assert from 'node:assert/strict';
import test from 'node:test';

import { getPushRuntimeConfig } from '../api/_lib/env.js';
import { buildNotificationPayload, createPushSender } from '../api/_lib/web-push.js';

const ENV_NAMES = [
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
  'CRON_SECRET',
];

const config = {
  publicKey: 'public-vapid-key',
  privateKey: 'private-vapid-key',
  subject: 'mailto:teacher@example.invalid',
  cronSecret: 'cron-secret',
};

const subscription = {
  endpoint: 'https://push.example/device-secret',
  keys: { p256dh: 'p256dh-secret', auth: 'auth-secret' },
};

test('push runtime config reads server-only environment variables', () => {
  const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = config.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = config.privateKey;
  process.env.WEB_PUSH_SUBJECT = config.subject;
  process.env.CRON_SECRET = config.cronSecret;
  try {
    assert.deepEqual(getPushRuntimeConfig(), config);
  } finally {
    for (const name of ENV_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('push runtime config rejects a subject without the required URL scheme', () => {
  const previous = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = config.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = config.privateKey;
  process.env.WEB_PUSH_SUBJECT = 'teacher@example.invalid';
  process.env.CRON_SECRET = config.cronSecret;
  try {
    assert.throws(
      () => getPushRuntimeConfig(),
      /WEB_PUSH_SUBJECT must start with mailto: or https:\/\//,
    );
  } finally {
    for (const name of ENV_NAMES) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('sleep notification payload uses the approved copy and deep link', () => {
  const { web_push, mutable, notification, ...legacy } = JSON.parse(buildNotificationPayload({
    type: 'sleep', referenceDate: '2026-09-09',
  }));
  assert.deepEqual(legacy, {
    title: '좋은 아침이에요 ☀️',
    body: '어젯밤 수면 기록을 간단히 남겨보세요.',
    tag: 'record-sleep-2026-09-09',
    data: {
      type: 'sleep',
      referenceDate: '2026-09-09',
      url: '/?open=sleep&date=2026-09-09',
    },
  });
});

test('caffeine notification payload uses the approved copy and deep link', () => {
  const { web_push, mutable, notification, ...legacy } = JSON.parse(buildNotificationPayload({
    type: 'caffeine', referenceDate: '2026-09-10',
  }));
  assert.deepEqual(legacy, {
    title: '오늘의 기록을 돌아볼 시간이에요 🌙',
    body: '오늘의 카페인 기록을 확인해 주세요. 마시지 않았다면 ‘섭취 안 함’을 선택하면 돼요.',
    tag: 'record-caffeine-2026-09-10',
    data: {
      type: 'caffeine',
      referenceDate: '2026-09-10',
      url: '/?open=caffeine&date=2026-09-10',
    },
  });
});

test('push sender configures VAPID and maps a successful delivery', async () => {
  let vapidArgs;
  let deliveredPayload;
  const sender = createPushSender({
    config,
    setVapidDetails(...args) { vapidArgs = args; },
    async sendNotification(_subscription, payload) { deliveredPayload = payload; },
    delay: async () => {},
  });
  const payload = buildNotificationPayload({ type: 'sleep', referenceDate: '2026-09-09' });

  assert.deepEqual(await sender.send(subscription, payload), { status: 'success', errorCode: null });
  assert.deepEqual(vapidArgs, [config.subject, config.publicKey, config.privateKey]);
  assert.equal(deliveredPayload, payload);
});

test('declarative notifications navigate to distinct record screens without worker click handling', () => {
  for (const type of ['sleep', 'caffeine']) {
    const payload = JSON.parse(buildNotificationPayload({ type, referenceDate: '2026-10-09' }));
    assert.equal(payload.web_push, 8030);
    assert.equal(payload.mutable, false);
    assert.equal(payload.notification.navigate, `/?open=${type}&date=2026-10-09`);
    assert.equal(payload.notification.title, payload.title);
    assert.equal(payload.notification.body, payload.body);
    assert.equal(payload.notification.tag, `record-${type}-2026-10-09`);
    assert.equal(payload.notification.icon, '/public/icons/icon-192.png');
    assert.deepEqual(payload.notification.data, payload.data);
    assert.equal(new URL(payload.notification.navigate, 'https://app.example/').origin, 'https://app.example');
  }
});

test('push provider requests have a finite timeout and transport timeouts are not replayed', async () => {
  let attempts = 0;
  let requestedTimeout;
  const sender = createPushSender({
    config, setVapidDetails() {},
    async sendNotification(_subscription, _payload, options) {
      attempts++;
      requestedTimeout = options?.timeout;
      throw new Error('transport timeout after provider might have accepted');
    },
  });
  assert.deepEqual(await sender.send(subscription, '{}'), { status:'failed', errorCode:'PUSH_UNAVAILABLE' });
  assert.equal(attempts, 1);
  assert.ok(requestedTimeout > 0 && requestedTimeout <= 10_000);
});

test('push sender maps 404 and 410 responses to expired without retrying', async () => {
  for (const statusCode of [404, 410]) {
    let attempts = 0;
    const sender = createPushSender({
      config,
      setVapidDetails() {},
      async sendNotification() {
        attempts += 1;
        throw Object.assign(new Error('gone'), { statusCode });
      },
      delay: async () => {},
    });
    assert.deepEqual(await sender.send(subscription, '{}'), {
      status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED',
    });
    assert.equal(attempts, 1);
  }
});

test('push sender retries a 429 once and can then succeed', async () => {
  let attempts = 0;
  const sender = createPushSender({
    config,
    setVapidDetails() {},
    async sendNotification() {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('rate limited'), { statusCode: 429 });
    },
    delay: async () => {},
    maxAttempts: 2,
  });
  assert.deepEqual(await sender.send(subscription, '{}'), { status: 'success', errorCode: null });
  assert.equal(attempts, 2);
});

test('push sender bounds server-error retries and returns a stable code', async () => {
  let attempts = 0;
  const sender = createPushSender({
    config,
    setVapidDetails() {},
    async sendNotification() {
      attempts += 1;
      throw Object.assign(new Error('provider internal detail'), { statusCode: 503 });
    },
    delay: async () => {},
    maxAttempts: 2,
  });
  assert.deepEqual(await sender.send(subscription, '{}'), {
    status: 'failed', errorCode: 'PUSH_SERVER_ERROR',
  });
  assert.equal(attempts, 2);
});

test('push sender never exposes provider messages or subscription secrets', async () => {
  const sender = createPushSender({
    config,
    setVapidDetails() {},
    async sendNotification() {
      throw new Error(`provider leaked ${subscription.endpoint} ${subscription.keys.auth}`);
    },
    delay: async () => {},
  });
  const result = await sender.send(subscription, '{}');
  assert.deepEqual(result, { status: 'failed', errorCode: 'PUSH_UNAVAILABLE' });
  assert.doesNotMatch(JSON.stringify(result), /device-secret|auth-secret|provider leaked/);
});
