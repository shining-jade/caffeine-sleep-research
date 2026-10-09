import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createSession } from '../api/_lib/session.js';
import { subscriptionIdForEndpoint } from '../api/_lib/push-subscription.js';
import { createReminderConfigHandler } from '../api/_lib/teacher/reminders/config.js';
import { createTestSendHandler } from '../api/_lib/teacher/reminders/test-send.js';
import { createTestStudentHandler } from '../api/_lib/teacher/reminders/test-student.js';
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

test('teacher test subscription stays browser-local when the endpoint already belongs to a student', async () => {
  let gatewayCalls = 0;
  const subscriptionId = subscriptionIdForEndpoint(SUBSCRIPTION.endpoint);
  const handler = createTestSubscribeHandler({
    now: () => NOW,
    callGas: async () => { gatewayCalls += 1; throw new Error('role collision'); },
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ subscription: SUBSCRIPTION }), teacherCookie()), res);
  assert.deepEqual(res.json(), { success: true, subscriptionId });
  assert.equal(gatewayCalls, 0);
  assert.doesNotMatch(res.body, /push\.example|teacher-public-key|teacher-auth-key/);
});

test('teacher test send bypasses student ownership storage and sends only to the current browser', async () => {
  let gatewayCalls = 0;
  let delivered;
  const handler = createTestSendHandler({
    now: () => NOW,
    callGas: async () => { gatewayCalls += 1; throw new Error('role collision'); },
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
  assert.equal(gatewayCalls, 0);
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

test('test student status requires a teacher session and returns aggregate counts only', async () => {
  let forwarded;
  const handler = createTestStudentHandler({
    now: () => NOW,
    callGas: async (input) => {
      forwarded = input;
      return { name: '테스트', sleepDevices: 2, caffeineDevices: 1, studentId: '1101', endpoint: 'https://push.example/private' };
    },
  });
  const denied = response();
  await handler(request('GET'), denied);
  assert.equal(denied.statusCode, 401);

  const res = response();
  await handler(request('GET', undefined, teacherCookie()), res);
  assert.deepEqual(res.json(), { success: true, name: '테스트', sleepDevices: 2, caffeineDevices: 1 });
  assert.deepEqual(forwarded, {
    role: 'teacher', action: 'getTestStudentReminderStatus', params: [], subject: null,
  });
  assert.doesNotMatch(res.body, /1101|push\.example/);

  const wrongMethod = response();
  await handler(request('PUT', '{}', teacherCookie()), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});

test('test student send rejects identity subscription and extra fields before any gateway call', async () => {
  let calls = 0;
  const handler = createTestStudentHandler({
    now: () => NOW,
    callGas: async () => { calls += 1; },
  });
  for (const body of [
    { type: 'all' },
    { type: 'sleep', studentId: '1101' },
    { type: 'sleep', subscriptionId: 'device' },
    { type: 'sleep', subscription: SUBSCRIPTION },
    { type: 'sleep', endpoint: SUBSCRIPTION.endpoint },
    { type: 'sleep', keys: SUBSCRIPTION.keys },
    { type: 'sleep', extra: true },
  ]) {
    const res = response();
    await handler(request('POST', JSON.stringify(body), teacherCookie()), res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('confirmed push outcomes survive a failed result log without sending twice', async () => {
  let sends = 0, writes = 0;
  const handler = createTestStudentHandler({
    now:()=>NOW,
    callGas:async ({action})=>{
      if(action==='getTestStudentReminderTargets') return {subscriptions:[{
        studentId:'0',subscriptionId:subscriptionIdForEndpoint(SUBSCRIPTION.endpoint),...SUBSCRIPTION,
      }]};
      writes++;
      throw Object.assign(new Error('private log detail'),{code:'GAS_TIMEOUT',status:504});
    },
    createSender:()=>({async send(){sends++;return {status:'success'};}}),
  });
  const res=response();
  await handler(request('POST',JSON.stringify({type:'caffeine'}),teacherCookie()),res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.json(),{success:true,type:'caffeine',targeted:1,sent:1,expired:0,failed:0,logSaved:false});
  assert.equal(sends,1);assert.equal(writes,1);
  assert.doesNotMatch(res.body,/private|push\.example/);
});

test('test student send delivers approved copy and persists aggregate lifecycle results', async () => {
  const deviceA = { ...SUBSCRIPTION, endpoint: 'https://push.example/student-a' };
  const deviceB = { ...SUBSCRIPTION, endpoint: 'https://push.example/student-b' };
  const idA = subscriptionIdForEndpoint(deviceA.endpoint);
  const idB = subscriptionIdForEndpoint(deviceB.endpoint);
  const gasCalls = [];
  const deliveries = [];
  const outcomes = [
    { status: 'success', errorCode: null },
    { status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED' },
  ];
  const handler = createTestStudentHandler({
    now: () => NOW,
    randomId: () => 'req-1',
    callGas: async (input) => {
      gasCalls.push(input);
      if (input.action === 'getTestStudentReminderTargets') {
        return { name: '테스트', subscriptions: [
          { studentId: '1101', subscriptionId: idA, ...deviceA },
          { studentId: '1101', subscriptionId: idB, ...deviceB },
        ] };
      }
      return { recorded: input.params[2].length };
    },
    createSender: () => ({
      async send(subscription, payload) {
        deliveries.push({ subscription, payload: JSON.parse(payload) });
        return outcomes[deliveries.length - 1];
      },
    }),
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ type: 'sleep' }), teacherCookie()), res);

  assert.deepEqual(res.json(), {
    success: true, type: 'sleep', targeted: 2, sent: 1, expired: 1, failed: 0,
  });
  assert.equal(deliveries[0].payload.body, '어젯밤 수면 기록을 간단히 남겨보세요.');
  assert.equal(deliveries[0].payload.data.referenceDate, '2026-09-09');
  assert.deepEqual(gasCalls.map(({ action }) => action), [
    'getTestStudentReminderTargets', 'recordTestStudentReminderResults',
  ]);
  assert.match(gasCalls[1].params[2][0].deliveryKey, new RegExp(`^manual-test:req-1:sleep:${idA}$`));
  assert.doesNotMatch(res.body, /1101|push\.example|teacher-auth-key|teacher-public-key/);
});

test('test student send converts thrown and provider failures to safe aggregate results', async () => {
  const devices = ['a', 'b'].map((suffix) => {
    const subscription = { ...SUBSCRIPTION, endpoint: `https://push.example/${suffix}` };
    return { studentId: '1101', subscriptionId: subscriptionIdForEndpoint(subscription.endpoint), ...subscription };
  });
  let saved;
  let sendCount = 0;
  const handler = createTestStudentHandler({
    now: () => NOW,
    randomId: () => 'req-2',
    callGas: async ({ action, params }) => {
      if (action === 'getTestStudentReminderTargets') return { name: '테스트', subscriptions: devices };
      saved = params[2];
      return { recorded: saved.length };
    },
    createSender: () => ({
      async send() {
        sendCount += 1;
        if (sendCount === 1) throw new Error(`provider leaked ${SUBSCRIPTION.endpoint}`);
        return { status: 'failed', errorCode: 'PUSH_SERVER_ERROR' };
      },
    }),
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ type: 'caffeine' }), teacherCookie()), res);

  assert.deepEqual(res.json(), {
    success: true, type: 'caffeine', targeted: 2, sent: 0, expired: 0, failed: 2,
  });
  assert.deepEqual(saved.map(({ status, errorCode }) => ({ status, errorCode })), [
    { status: 'failed', errorCode: 'PUSH_UNAVAILABLE' },
    { status: 'failed', errorCode: 'PUSH_SERVER_ERROR' },
  ]);
  assert.doesNotMatch(res.body, /provider leaked|push\.example/);
});
