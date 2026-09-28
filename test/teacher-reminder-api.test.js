import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createSession } from '../api/_lib/session.js';
import { subscriptionIdForEndpoint } from '../api/_lib/push-subscription.js';
import { createReminderConfigHandler } from '../api/_lib/teacher/reminders/config.js';
import { createTestSendHandler } from '../api/_lib/teacher/reminders/test-send.js';
import { createTestSubscribeHandler } from '../api/_lib/teacher/reminders/test-subscribe.js';

process.env.SESSION_SECRET = 'teacher-reminder-session-secret';

const NOW = Math.floor(Date.parse('2026-09-09T22:00:00.000Z') / 1000); // 2026-09-10 07:00 KST
const SUBSCRIPTION = {
  endpoint: 'https://push.example/teacher-device',
  expirationTime: null,
  keys: { p256dh: 'teacher-public-key', auth: 'teacher-auth-key' },
};

function config(overrides = {}) {
  return {
    enabled: false,
    sleepEnabled: true,
    caffeineEnabled: true,
    sleepTime: '08:00',
    caffeineTime: '20:00',
    includeWeekends: true,
    classPeriods: [1, 2, 3, 4].map((classId) => ({
      classId: String(classId), startDate: '2026-09-01', endDate: '2026-10-05',
    })),
    ...overrides,
  };
}

function request(method, body, cookie = '') {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.method = method;
  req.headers = cookie ? { cookie } : {};
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

function teacherCookie(overrides = {}) {
  const token = createSession({ role: 'teacher', exp: NOW + 3600, ...overrides }, NOW);
  return `caffeine_session=${encodeURIComponent(token)}`;
}

test('teacher reminder APIs reject unauthenticated and wrong-method requests', async () => {
  let calls = 0;
  const dependencies = { callGas: async () => { calls += 1; }, now: () => NOW };
  for (const [handler, req] of [
    [createReminderConfigHandler(dependencies), request('GET')],
    [createReminderConfigHandler(dependencies), request('PUT', '{}', teacherCookie())],
    [createTestSubscribeHandler(dependencies), request('GET', undefined, teacherCookie())],
    [createTestSendHandler(dependencies), request('GET', undefined, teacherCookie())],
  ]) {
    const res = response();
    await handler(req, res);
    assert.ok([401, 405].includes(res.statusCode));
  }
  assert.equal(calls, 0);
});

test('teacher reminder config GET returns public key aggregates and next KST times only', async () => {
  let forwarded;
  const handler = createReminderConfigHandler({
    now: () => NOW,
    getPushConfig: () => ({ publicKey: 'public-vapid-key' }),
    callGas: async (input) => {
      forwarded = input;
      return {
        config: config(),
        subscriberCounts: { students: 2, devices: 3, byClass: { 1: 2, 2: 1, 3: 0, 4: 0 } },
        lastRun: { at: '2026-09-09T20:12:00+09:00', targeted: 3, sent: 2, expired: 1, failed: 0 },
        studentIds: ['1101'],
        endpoint: 'https://push.example/private',
      };
    },
  });
  const res = response();
  await handler(request('GET', undefined, teacherCookie()), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    success: true,
    publicKey: 'public-vapid-key',
    config: config(),
    subscriberCounts: { students: 2, devices: 3, byClass: { 1: 2, 2: 1, 3: 0, 4: 0 } },
    lastRun: { at: '2026-09-09T20:12:00+09:00', targeted: 3, sent: 2, expired: 1, failed: 0 },
    nextRuns: {
      sleep: '2026-09-10T08:00:00+09:00',
      caffeine: '2026-09-10T20:00:00+09:00',
    },
  });
  assert.doesNotMatch(res.body, /1101|push\.example|teacher-auth-key/);
  assert.deepEqual(forwarded, {
    role: 'teacher', action: 'getReminderAdminConfig', params: [], subject: null,
  });
});

test('teacher reminder config GET accepts the initial disabled configuration before dates are set', async () => {
  const initialConfig = config({
    classPeriods: [1, 2, 3, 4].map((classId) => ({
      classId: String(classId), startDate: '', endDate: '',
    })),
  });
  const handler = createReminderConfigHandler({
    now: () => NOW,
    getPushConfig: () => ({ publicKey: 'public-vapid-key' }),
    callGas: async () => ({ config: initialConfig }),
  });
  const res = response();
  await handler(request('GET', undefined, teacherCookie()), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().config, initialConfig);
  assert.deepEqual(res.json().nextRuns, { sleep: null, caffeine: null });
});

test('teacher reminder config POST rejects non-hour and reversed class ranges', async () => {
  let calls = 0;
  const handler = createReminderConfigHandler({ callGas: async () => { calls += 1; }, now: () => NOW });
  for (const invalid of [
    config({ sleepTime: '08:30' }),
    config({ classPeriods: [
      { classId: '1', startDate: '2026-10-02', endDate: '2026-10-01' },
      ...config().classPeriods.slice(1),
    ] }),
  ]) {
    const res = response();
    await handler(request('POST', JSON.stringify(invalid), teacherCookie()), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('teacher reminder config POST saves one normalized configuration', async () => {
  let forwarded;
  const handler = createReminderConfigHandler({
    now: () => NOW,
    callGas: async (input) => { forwarded = input; return input.params[0]; },
  });
  const res = response();
  await handler(request('POST', JSON.stringify(config({ sleepTime: '8:00' })), teacherCookie()), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().config.sleepTime, '08:00');
  assert.deepEqual(forwarded, {
    role: 'teacher', action: 'saveReminderAdminConfig', params: [config()], subject: null,
  });
});

test('teacher test subscription registers only the current browser and returns no endpoint keys', async () => {
  let forwarded;
  const subscriptionId = subscriptionIdForEndpoint(SUBSCRIPTION.endpoint);
  const handler = createTestSubscribeHandler({
    now: () => NOW,
    callGas: async (input) => { forwarded = input; return { subscriptionId, active: true }; },
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ subscription: SUBSCRIPTION }), teacherCookie()), res);
  assert.deepEqual(res.json(), { success: true, subscriptionId });
  assert.equal(forwarded.action, 'saveTeacherTestSubscription');
  assert.equal(forwarded.params[0].role, 'teacher-test');
  assert.doesNotMatch(res.body, /push\.example|teacher-public-key|teacher-auth-key/);
});

test('teacher test send rejects student IDs and sends approved copy only to confirmed teacher device', async () => {
  const calls = [];
  let delivered;
  const subscriptionId = subscriptionIdForEndpoint(SUBSCRIPTION.endpoint);
  const handler = createTestSendHandler({
    now: () => NOW,
    callGas: async (input) => { calls.push(input); return { subscriptionId, active: true }; },
    createSender: () => ({
      async send(subscription, payload) { delivered = { subscription, payload: JSON.parse(payload) }; return { status: 'success', errorCode: null }; },
    }),
  });
  const denied = response();
  await handler(request('POST', JSON.stringify({ type: 'sleep', studentId: '1101', subscriptionId: 'student-device' }), teacherCookie()), denied);
  assert.equal(denied.statusCode, 400);

  const res = response();
  await handler(request('POST', JSON.stringify({ type: 'sleep', subscription: SUBSCRIPTION }), teacherCookie()), res);
  assert.deepEqual(res.json(), { success: true, status: 'success' });
  assert.equal(calls[0].action, 'saveTeacherTestSubscription');
  assert.deepEqual(delivered.subscription, SUBSCRIPTION);
  assert.equal(delivered.payload.title, '좋은 아침이에요 ☀️');
  assert.equal(delivered.payload.body, '어젯밤 수면 기록을 간단히 남겨보세요.');
});

test('teacher test send maps provider failures without exposing provider or device details', async () => {
  const subscriptionId = subscriptionIdForEndpoint(SUBSCRIPTION.endpoint);
  const handler = createTestSendHandler({
    now: () => NOW,
    callGas: async () => ({ subscriptionId, active: true }),
    createSender: () => ({
      async send() { return { status: 'failed', errorCode: 'PUSH_SERVER_ERROR' }; },
    }),
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ type: 'caffeine', subscription: SUBSCRIPTION }), teacherCookie()), res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { success: false, error: 'PUSH_SERVER_ERROR' });
  assert.doesNotMatch(res.body, /push\.example|teacher-auth-key/);
});
