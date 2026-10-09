import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createReminderRunHandler } from '../api/reminders/run.js';

const SECRET = 'cron-secret-for-tests';
const NOW = Math.floor(Date.parse('2026-09-09T23:00:00.000Z') / 1000); // 08:00 KST

function request(method = 'GET', authorization) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = authorization === undefined ? {} : { authorization };
  return req;
}

function response() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') { this.body = value; },
    json() { return JSON.parse(this.body); },
  };
}

function sleepSnapshot(overrides = {}) {
  return {
    config: {
      enabled: true,
      sleepEnabled: true,
      caffeineEnabled: true,
      sleepTime: '08:00',
      caffeineTime: '20:00',
      includeWeekends: true,
      classPeriods: [
        { classId: '1', startDate: '2026-09-01', endDate: '2026-10-05' },
      ],
    },
    students: [{ studentId: '1101', classId: '1' }],
    completedStudentIds: [],
    subscriptions: [{
      studentId: '1101', subscriptionId: 'device-a', endpoint: 'https://push.example/a',
      keys: { p256dh: 'public-a', auth: 'auth-a' }, sleepEnabled: true, caffeineEnabled: true, active: true,
    }],
    successfulDeliveryKeys: [],
    ...overrides,
  };
}

function authorizedRequest() {
  return request('GET', `Bearer ${SECRET}`);
}

test('retired scheduled test URLs cannot fall through into ordinary student dispatch', async () => {
  let calls = 0;
  const handler = createReminderRunHandler({ getCronSecret: () => SECRET, now: () => NOW,
    callGas: async () => { calls++; throw new Error('must not dispatch'); },
  });
  for (const id of ['20261010-sleep-03', '20261010-sleep-06', '']) {
    const req = authorizedRequest(); req.url = `/api/reminders/run?scheduledTest=${id}`;
    const res = response(); await handler(req, res);
    assert.equal(res.statusCode, 410);
    assert.equal(res.json().error, 'SCHEDULED_TEST_EXPIRED');
  }
  assert.equal(calls, 0);
});

test('Cron endpoint rejects wrong methods and missing wrong or duplicate authorization', async () => {
  let gatewayCalls = 0;
  const handler = createReminderRunHandler({
    getCronSecret: () => SECRET,
    callGas: async () => { gatewayCalls += 1; },
    now: () => NOW,
  });
  for (const req of [
    request('POST', `Bearer ${SECRET}`),
    request('GET'),
    request('GET', 'Bearer wrong'),
    request('GET', [`Bearer ${SECRET}`, `Bearer ${SECRET}`]),
    request('GET', `Bearer ${SECRET}, Bearer ${SECRET}`),
  ]) {
    const res = response();
    await handler(req, res);
    assert.ok([401, 405].includes(res.statusCode));
    assert.doesNotMatch(res.body, /cron-secret|wrong/);
  }
  assert.equal(gatewayCalls, 0);
});

test('Cron fails closed for gateway errors invalid snapshots and disabled or out-of-hour settings', async () => {
  let sends = 0;
  const createSender = () => ({ send: async () => { sends += 1; return { status: 'success', errorCode: null }; } });
  for (const snapshot of [
    new Error('private endpoint https://push.example/leak'),
    { config: {}, subscriptions: [{ endpoint: 'https://push.example/leak' }] },
    sleepSnapshot({ config: { ...sleepSnapshot().config, enabled: false } }),
    sleepSnapshot({ config: { ...sleepSnapshot().config, sleepTime: '09:00' } }),
  ]) {
    const handler = createReminderRunHandler({
      getCronSecret: () => SECRET,
      now: () => NOW,
      createSender,
      callGas: async ({ action }) => {
        if (action === 'getReminderDispatchSnapshot') {
          if (snapshot instanceof Error) throw snapshot;
          return snapshot;
        }
        throw new Error('unexpected mutation');
      },
    });
    const res = response();
    await handler(authorizedRequest(), res);
    if (snapshot instanceof Error || !snapshot.config.sleepTime) {
      assert.equal(res.statusCode, 502);
      assert.doesNotMatch(res.body, /push\.example|private endpoint/);
    } else {
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().targeted, 0);
    }
  }
  assert.equal(sends, 0);
});

test('Cron returns zero targets for the initial disabled configuration with empty class dates', async () => {
  const initial = sleepSnapshot({
    config: {
      ...sleepSnapshot().config,
      enabled: false,
      classPeriods: [{ classId: '1', startDate: '', endDate: '' }],
    },
  });
  const handler = createReminderRunHandler({
    getCronSecret: () => SECRET,
    now: () => NOW,
    callGas: async ({ action }) => {
      if (action === 'getReminderDispatchSnapshot') return initial;
      throw new Error('unexpected mutation');
    },
  });
  const res = response();
  await handler(authorizedRequest(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    success: true, type: 'none', targeted: 0, sent: 0, expired: 0, failed: 0, skipped: 0,
  });
});

test('Cron claims before sending and records aggregate successful delivery results', async () => {
  const calls = [];
  const handler = createReminderRunHandler({
    getCronSecret: () => SECRET,
    now: () => NOW,
    createExecutionId: () => 'execution-one',
    callGas: async (input) => {
      calls.push(input);
      if (input.action === 'getReminderDispatchSnapshot') return sleepSnapshot();
      if (input.action === 'claimReminderDeliveries') return input.params[0];
      if (input.action === 'recordReminderDeliveryResults') return { recorded: input.params[0].length };
      throw new Error('unexpected action');
    },
    createSender: () => ({ send: async () => ({ status: 'success', errorCode: null }) }),
  });
  const res = response();
  await handler(authorizedRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    success: true, type: 'sleep', targeted: 1, sent: 1, expired: 0, failed: 0, skipped: 0,
  });
  assert.deepEqual(calls.map(({ action }) => action), [
    'getReminderDispatchSnapshot', 'claimReminderDeliveries', 'recordReminderDeliveryResults',
  ]);
  assert.deepEqual(calls[1].params, [['2026-09-09:sleep:device-a'], 'execution-one', '2026-09-09T23:00:00.000Z']);
  assert.deepEqual(calls[2].params[0][0], {
    deliveryKey: '2026-09-09:sleep:device-a',
    referenceDate: '2026-09-09',
    type: 'sleep',
    studentId: '1101',
    subscriptionId: 'device-a',
    status: 'success',
    errorCode: '',
  });
  assert.doesNotMatch(res.body, /1101|device-a|push\.example|auth-a|public-a/);
});

test('Cron sends only atomically claimed devices and skips prior successes or overlapping claims', async () => {
  const base = sleepSnapshot();
  const secondDevice = {
    ...base.subscriptions[0], subscriptionId: 'device-b', endpoint: 'https://push.example/b',
  };
  for (const { snapshot, claimed, expectedTargeted, expectedSkipped } of [
    {
      snapshot: sleepSnapshot({ successfulDeliveryKeys: ['2026-09-09:sleep:device-a'] }),
      claimed: [], expectedTargeted: 0, expectedSkipped: 0,
    },
    {
      snapshot: sleepSnapshot({ subscriptions: [base.subscriptions[0], secondDevice] }),
      claimed: ['2026-09-09:sleep:device-b'], expectedTargeted: 2, expectedSkipped: 1,
    },
  ]) {
    let sends = 0;
    const handler = createReminderRunHandler({
      getCronSecret: () => SECRET,
      now: () => NOW,
      callGas: async ({ action, params }) => {
        if (action === 'getReminderDispatchSnapshot') return snapshot;
        if (action === 'claimReminderDeliveries') return claimed.filter((key) => params[0].includes(key));
        if (action === 'recordReminderDeliveryResults') return { recorded: params[0].length };
        throw new Error('unexpected action');
      },
      createSender: () => ({ send: async () => { sends += 1; return { status: 'success', errorCode: null }; } }),
    });
    const res = response();
    await handler(authorizedRequest(), res);
    assert.equal(res.json().targeted, expectedTargeted);
    assert.equal(res.json().skipped, expectedSkipped);
    assert.equal(sends, claimed.length);
  }
});

test('Cron records expired transient and thrown failures for every claimed device', async () => {
  const base = sleepSnapshot();
  const subscriptions = ['expired', 'failed', 'thrown'].map((suffix) => ({
    ...base.subscriptions[0], subscriptionId: `device-${suffix}`, endpoint: `https://push.example/${suffix}`,
  }));
  let recorded;
  const handler = createReminderRunHandler({
    getCronSecret: () => SECRET,
    now: () => NOW,
    callGas: async ({ action, params }) => {
      if (action === 'getReminderDispatchSnapshot') return sleepSnapshot({ subscriptions });
      if (action === 'claimReminderDeliveries') return params[0];
      if (action === 'recordReminderDeliveryResults') { recorded = params[0]; return { recorded: params[0].length }; }
      throw new Error('unexpected action');
    },
    createSender: () => ({
      async send(subscription) {
        if (subscription.endpoint.endsWith('/expired')) return { status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED' };
        if (subscription.endpoint.endsWith('/failed')) return { status: 'failed', errorCode: 'PUSH_SERVER_ERROR' };
        throw new Error('provider secret');
      },
    }),
  });
  const res = response();
  await handler(authorizedRequest(), res);

  assert.deepEqual(res.json(), {
    success: true, type: 'sleep', targeted: 3, sent: 0, expired: 1, failed: 2, skipped: 0,
  });
  assert.deepEqual(recorded.map(({ status, errorCode }) => ({ status, errorCode })), [
    { status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED' },
    { status: 'failed', errorCode: 'PUSH_SERVER_ERROR' },
    { status: 'failed', errorCode: 'PUSH_UNAVAILABLE' },
  ]);
  assert.doesNotMatch(res.body, /provider secret|push\.example|device-/);
});

test('Cron bounds concurrent push sends', async () => {
  const base = sleepSnapshot();
  const subscriptions = Array.from({ length: 9 }, (_, index) => ({
    ...base.subscriptions[0], subscriptionId: `device-${index}`, endpoint: `https://push.example/${index}`,
  }));
  let active = 0;
  let maximum = 0;
  const handler = createReminderRunHandler({
    getCronSecret: () => SECRET,
    now: () => NOW,
    concurrency: 3,
    callGas: async ({ action, params }) => {
      if (action === 'getReminderDispatchSnapshot') return sleepSnapshot({ subscriptions });
      if (action === 'claimReminderDeliveries') return params[0];
      if (action === 'recordReminderDeliveryResults') return { recorded: params[0].length };
      throw new Error('unexpected action');
    },
    createSender: () => ({
      async send() {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { status: 'success', errorCode: null };
      },
    }),
  });
  const res = response();
  await handler(authorizedRequest(), res);
  assert.equal(res.json().sent, 9);
  assert.ok(maximum <= 3);
  assert.ok(maximum > 1);
});
