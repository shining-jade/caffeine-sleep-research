import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createReminderRunHandler } from '../api/reminders/run.js';
import { subscriptionIdForEndpoint } from '../api/_lib/push-subscription.js';

const SECRET = 'scheduled-test-secret';
const PILOT = '20261010-sleep-06';
const NOW = Date.parse('2026-10-09T21:15:00Z') / 1000; // 06:15 KST
const target = (studentId = '0', suffix = 'phone') => {
  const endpoint = `https://push.example/${suffix}`;
  return { studentId, subscriptionId: subscriptionIdForEndpoint(endpoint), endpoint,
    keys: { p256dh: 'public-key', auth: 'auth-key' } };
};
function req(id = PILOT, secret = SECRET) {
  return { method: 'GET', url: `/api/reminders/run?scheduledTest=${id}`,
    headers: { authorization: `Bearer ${secret}` } };
}
function response() {
  return { statusCode: 0, body: '', setHeader() {}, end(value) { this.body = value; },
    json() { return JSON.parse(this.body); } };
}
function harness({ now = NOW, snapshot = { name: '테스트', subscriptions: [target()] },
  claim, recordFailure = false, sendFailure = false, targetFailure = false } = {}) {
  const calls = [], sends = [], events = [], successful = new Set();
  const handler = createReminderRunHandler({ getCronSecret: () => SECRET, now: () => now,
    onScheduledTestEvent: event => events.push(event),
    createExecutionId: () => 'execution-pilot',
    callGas: async (input) => {
      calls.push(input);
      if (input.action === 'getTestStudentReminderTargets') {
        if (targetFailure) throw new Error('private endpoint secret');
        return snapshot;
      }
      if (input.action === 'claimReminderDeliveries') return claim ?? input.params[0].filter(key => !successful.has(key));
      if (input.action === 'recordReminderDeliveryResults') {
        if (recordFailure) throw new Error('private log error');
        input.params[0].filter(value => value.status === 'success').forEach(value => successful.add(value.deliveryKey));
        return { recorded: input.params[0].length };
      }
      throw new Error('unexpected action');
    },
    createSender: () => ({ send: async (subscription, payload) => {
      sends.push({ subscription, payload });
      if (sendFailure) throw new Error('private endpoint failure');
      return { status: 'success' };
    } }),
  });
  return { handler, calls, sends, events };
}

test('scheduled pilot rejects unauthorized requests and unknown or duplicate pilot identifiers', async () => {
  const h = harness();
  for (const request of [req(PILOT, 'wrong'), req('unknown'), {
    ...req(), url: `/api/reminders/run?scheduledTest=${PILOT}&scheduledTest=${PILOT}`,
  }]) {
    const res = response(); await h.handler(request, res);
    assert.ok([400, 401].includes(res.statusCode));
  }
  assert.equal(h.calls.length, 0); assert.equal(h.sends.length, 0);
});

test('scheduled pilot is inert before after and on another day without reading or changing student data', async () => {
  for (const now of [NOW - 3600, NOW + 3600, NOW + 86400, NOW - 86400]) {
    const h = harness({ now }), res = response();
    await h.handler(req(), res);
    assert.equal(res.statusCode, 200); assert.equal(res.json().targeted, 0);
    assert.equal(h.calls.length, 0); assert.equal(h.sends.length, 0);
  }
});

test('scheduled pilot claims and sends only account 0 with the exact test name and deduplicates devices', async () => {
  const h = harness({ snapshot: { name: '테스트', subscriptions: [target(), target(), target('1101', 'real-student')] } });
  const res = response(); await h.handler(req(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.json().sent, 1);
  assert.equal(res.json().targeted, 1); assert.equal(h.sends.length, 1);
  assert.deepEqual(h.calls.map(({role, action}) => [role, action]), [
    ['teacher', 'getTestStudentReminderTargets'], ['scheduler', 'claimReminderDeliveries'],
    ['scheduler', 'recordReminderDeliveryResults'],
  ]);
  const recorded = h.calls[2].params[0][0];
  assert.equal(recorded.studentId, '0'); assert.equal(recorded.referenceDate, '2026-10-09');
  assert.equal(recorded.deliveryKey, `scheduled-test:${PILOT}:${target().subscriptionId}`);
  assert.match(JSON.parse(h.sends[0].payload).data.url, /open=sleep/);
  assert.doesNotMatch(res.body, /push\.example|public-key|auth-key|1101/);
});

test('scheduled pilot fails closed for wrong account name or invalid subscription identity', async () => {
  for (const snapshot of [
    { name: '다른 학생', subscriptions: [target()] },
    { name: '테스트', subscriptions: [{ ...target(), subscriptionId: 'a'.repeat(64) }] },
  ]) {
    const h = harness({ snapshot }), res = response(); await h.handler(req(), res);
    assert.equal(res.statusCode, 502); assert.equal(h.sends.length, 0);
  }
});

test('scheduled pilot skips successful previous deliveries and refuses unexpected claim keys', async () => {
  const h = harness();
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = response(); await h.handler(req(), res); assert.equal(res.statusCode, 200);
    assert.equal(res.json().sent, attempt === 0 ? 1 : 0);
  }
  assert.equal(h.sends.length, 1);
  const invalid = harness({ claim: ['unrequested-private-key'] }), res = response();
  await invalid.handler(req(), res); assert.equal(res.statusCode, 502); assert.equal(invalid.sends.length, 0);
});

test('scheduled pilot reports provider success separately from failed persistence and sends once in that invocation', async () => {
  const h = harness({ recordFailure: true }), res = response(); await h.handler(req(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.json().sent, 1);
  assert.equal(res.json().logSaved, false); assert.equal(h.sends.length, 1);
  assert.doesNotMatch(res.body, /private/);
});

test('scheduled pilot records a provider failure safely without retrying its send', async () => {
  const h = harness({ sendFailure: true }), res = response(); await h.handler(req(), res);
  assert.equal(res.statusCode, 200); assert.equal(res.json().failed, 1);
  assert.equal(h.sends.length, 1); assert.equal(h.calls[2].params[0][0].errorCode, 'PUSH_UNAVAILABLE');
});

test('temporary Cron preserves every existing hourly job and gives three gateway calls enough runtime', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.crons.filter(job => !job.path.includes('scheduledTest=')),
    Array.from({ length: 24 }, (_, hour) => ({
      path: `/api/reminders/run?slot=${String(hour).padStart(2, '0')}`, schedule: `0 ${hour} * * *`,
    })));
  assert.deepEqual(config.crons.filter(job => job.path.includes('scheduledTest=')), [
    { path: `/api/reminders/run?scheduledTest=${PILOT}`, schedule: '0 21 * * *' },
  ]);
  assert.ok(config.functions['api/reminders/run.js'].maxDuration >= 170);
});

test('scheduled pilot reports the failing preparation stage without secrets or replaying calls', async () => {
  const h = harness({ targetFailure: true }), res = response();
  await h.handler(req(), res);
  assert.equal(res.statusCode, 502);
  assert.equal(h.calls.length, 1);
  assert.equal(h.sends.length, 0);
  assert.deepEqual(h.events.map(e => e.stage), ['targets', 'targets']);
  assert.equal(h.events.at(-1).event, 'failed');
  assert.doesNotMatch(JSON.stringify(h.events), /private|endpoint|secret|auth|public-key/);
});

test('scheduled pilot records each operational stage and distinguishes provider acceptance from persistence', async () => {
  const h = harness({ recordFailure: true }), res = response();
  await h.handler(req(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(h.events.map(e => e.stage), ['targets', 'claim', 'send', 'record', 'finished']);
  assert.equal(h.events.at(-1).sent, 1);
  assert.equal(h.events.at(-1).logSaved, false);
  assert.doesNotMatch(JSON.stringify(h.events), /push\.example|auth-key|public-key/);
});

test('scheduled pilot does not create a sender for no eligible or no claimed devices', async () => {
  for (const options of [
    { snapshot: { name: '테스트', subscriptions: [target('1101')] } }, { claim: [] },
  ]) {
    const h = harness(options), res = response(); await h.handler(req(), res);
    assert.equal(res.statusCode, 200); assert.equal(res.json().sent, 0); assert.equal(h.sends.length, 0);
    assert.ok(!h.calls.some(call => call.action === 'recordReminderDeliveryResults'));
  }
});
