import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createSession } from '../api/_lib/session.js';
import { normalizePushSubscription, subscriptionIdForEndpoint } from '../api/_lib/push-subscription.js';
import { createConfigHandler } from '../api/student/push/config.js';
import { createPreferencesHandler } from '../api/student/push/preferences.js';
import { createSubscribeHandler } from '../api/student/push/subscribe.js';
import { createUnsubscribeHandler } from '../api/student/push/unsubscribe.js';

process.env.SESSION_SECRET = 'student-push-session-secret';
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'public-vapid-key';
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'private-vapid-key';
process.env.WEB_PUSH_SUBJECT = 'mailto:teacher@example.invalid';
process.env.CRON_SECRET = 'cron-secret';

const NOW = 1_800_000_000;
const ENDPOINT = 'https://push.example/device-a';
const SUBSCRIPTION = {
  endpoint: ENDPOINT,
  expirationTime: null,
  keys: { p256dh: 'public-key-value', auth: 'auth-key-value' },
};

function request(method, body, cookie = '', headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.method = method;
  req.headers = { ...headers, ...(cookie ? { cookie } : {}) };
  return req;
}

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    getHeader(name) { return headers.get(name.toLowerCase()); },
    end(value = '') { this.body = value; },
    json() { return JSON.parse(this.body); },
  };
}

function cookie(overrides = {}) {
  const token = createSession({
    role: 'student', studentId: '1101', name: '테스트학생', exp: NOW + 3600, ...overrides,
  }, NOW);
  return `caffeine_session=${encodeURIComponent(token)}`;
}

test('student push subscription normalization accepts only bounded HTTPS subscriptions', () => {
  assert.deepEqual(normalizePushSubscription(SUBSCRIPTION), SUBSCRIPTION);
  assert.match(subscriptionIdForEndpoint(ENDPOINT), /^[a-f0-9]{64}$/);
  assert.throws(() => normalizePushSubscription({ ...SUBSCRIPTION, endpoint: 'http://push.example/device' }), /invalid/i);
  assert.throws(() => normalizePushSubscription({ ...SUBSCRIPTION, keys: { p256dh: '', auth: 'a' } }), /invalid/i);
  assert.throws(() => normalizePushSubscription({ ...SUBSCRIPTION, endpoint: `https://push.example/${'x'.repeat(4096)}` }), /invalid/i);
});

test('student push config requires a student session and returns public settings only', async () => {
  let forwarded;
  const handler = createConfigHandler({
    now: () => NOW,
    callGas: async (input) => {
      forwarded = input;
      return { sleepTime: '08:00', caffeineTime: '20:00', globallyEnabled: false, private: 'hidden' };
    },
    getPushConfig: () => ({ publicKey: 'public-vapid-key' }),
  });
  const unauthorized = response();
  await handler(request('GET'), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const res = response();
  await handler(request('GET', undefined, cookie()), res);
  assert.deepEqual(res.json(), {
    success: true,
    publicKey: 'public-vapid-key',
    sleepTime: '08:00',
    caffeineTime: '20:00',
    globallyEnabled: false,
  });
  assert.equal(JSON.stringify(res.json()).includes('private'), false);
  assert.deepEqual(forwarded.subject, { studentId: '1101', name: '테스트학생' });
});

test('student push endpoints reject wrong methods and invalid sessions before gateway calls', async () => {
  let calls = 0;
  const dependencies = { callGas: async () => { calls += 1; }, now: () => NOW };
  const cases = [
    [createSubscribeHandler(dependencies), request('GET', undefined, cookie())],
    [createPreferencesHandler(dependencies), request('PUT', undefined, cookie())],
    [createUnsubscribeHandler(dependencies), request('GET', undefined, cookie())],
    [createSubscribeHandler(dependencies), request('POST', JSON.stringify({ subscription: SUBSCRIPTION }))],
    [createSubscribeHandler(dependencies), request('POST', JSON.stringify({ subscription: SUBSCRIPTION }), `${cookie()}x`)],
    [createSubscribeHandler({ ...dependencies, now: () => NOW + 7200 }), request('POST', JSON.stringify({ subscription: SUBSCRIPTION }), cookie())],
  ];
  for (const [handler, req] of cases) {
    const res = response();
    await handler(req, res);
    assert.ok([401, 405].includes(res.statusCode));
  }
  assert.equal(calls, 0);
});

test('student push subscribe rejects malformed oversized and unsafe subscriptions', async () => {
  let calls = 0;
  const handler = createSubscribeHandler({ callGas: async () => { calls += 1; }, now: () => NOW });
  for (const body of [
    '{bad',
    JSON.stringify({ subscription: { ...SUBSCRIPTION, endpoint: 'http://unsafe.example' } }),
    JSON.stringify({ subscription: { ...SUBSCRIPTION, keys: {} } }),
    JSON.stringify({ subscription: SUBSCRIPTION, padding: 'x'.repeat(256 * 1024) }),
  ]) {
    const res = response();
    await handler(request('POST', body, cookie()), res);
    assert.ok([400, 413].includes(res.statusCode));
    assert.doesNotMatch(res.body, /unsafe\.example|auth-key-value|public-key-value/);
  }
  assert.equal(calls, 0);
});

test('student push subscribe overwrites cross-student identity and returns only subscription ID', async () => {
  let forwarded;
  const expectedId = subscriptionIdForEndpoint(ENDPOINT);
  const handler = createSubscribeHandler({
    now: () => NOW,
    callGas: async (input) => { forwarded = input; return { subscriptionId: expectedId, active: true }; },
  });
  const res = response();
  await handler(request('POST', JSON.stringify({
    subscription: SUBSCRIPTION,
    sleepEnabled: true,
    caffeineEnabled: false,
    studentId: '9999',
    name: '다른학생',
  }), cookie()), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { success: true, subscriptionId: expectedId });
  assert.equal(JSON.stringify(res.json()).includes('endpoint'), false);
  assert.deepEqual(forwarded, {
    role: 'student',
    action: 'savePushSubscription',
    params: [{
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'public-key-value', auth: 'auth-key-value' },
      sleepEnabled: true,
      caffeineEnabled: false,
      role: 'student',
      studentId: '1101',
    }],
    subject: { studentId: '1101', name: '테스트학생' },
  });
});

test('student push preferences read and update only the current device ID', async () => {
  const subscriptionId = subscriptionIdForEndpoint(ENDPOINT);
  const forwarded = [];
  const handler = createPreferencesHandler({
    now: () => NOW,
    callGas: async (input) => {
      forwarded.push(input);
      return { subscriptionId, sleepEnabled: input.action === 'getPushPreferences', caffeineEnabled: true, active: true };
    },
  });
  const getRes = response();
  await handler(request('GET', undefined, cookie(), { 'x-push-subscription-id': subscriptionId }), getRes);
  assert.deepEqual(getRes.json(), {
    success: true, subscriptionId, sleepEnabled: true, caffeineEnabled: true, active: true,
  });

  const postRes = response();
  await handler(request('POST', JSON.stringify({
    subscriptionId, sleepEnabled: false, caffeineEnabled: true, studentId: '9999',
  }), cookie()), postRes);
  assert.equal(postRes.json().sleepEnabled, false);
  assert.deepEqual(forwarded[1].params, [subscriptionId, { sleepEnabled: false, caffeineEnabled: true }]);
  assert.deepEqual(forwarded[1].subject, { studentId: '1101', name: '테스트학생' });
});

test('student push unsubscribe deactivates the endpoint-derived current device', async () => {
  let forwarded;
  const handler = createUnsubscribeHandler({
    now: () => NOW,
    callGas: async (input) => { forwarded = input; return { active: false }; },
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ endpoint: ENDPOINT }), cookie()), res);
  assert.deepEqual(res.json(), { success: true });
  assert.deepEqual(forwarded.params, [subscriptionIdForEndpoint(ENDPOINT)]);
  assert.deepEqual(forwarded.subject, { studentId: '1101', name: '테스트학생' });
});
