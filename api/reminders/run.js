import { randomUUID, timingSafeEqual } from 'node:crypto';

import { requireEnv } from '../_lib/env.js';
import { callGas as defaultCallGas } from '../_lib/gas.js';
import { sendJson } from '../_lib/http.js';
import {
  deliveryKey,
  getKstClock,
  normalizeStoredReminderConfig,
  selectReminderCandidates,
} from '../_lib/reminder-policy.js';
import { normalizePushSubscription } from '../_lib/push-subscription.js';
import { normalizeSchedulerRequest } from '../_lib/scheduler-policy.js';
import { runScheduledTestReminder, scheduledTestRequest } from '../_lib/scheduled-test-reminder.js';
import { buildNotificationPayload, createPushSender } from '../_lib/web-push.js';

const SAFE_ERROR_CODES = new Set([
  'PUSH_SUBSCRIPTION_EXPIRED',
  'PUSH_RATE_LIMITED',
  'PUSH_SERVER_ERROR',
  'PUSH_REJECTED',
  'PUSH_UNAVAILABLE',
]);

function authorized(req, secret) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || typeof secret !== 'string' || secret.length === 0) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function boundedText(value, maxLength = 256) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > maxLength) throw new Error('Invalid scheduler snapshot.');
  return text;
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid scheduler snapshot.');
  for (const key of ['students', 'completedStudentIds', 'subscriptions', 'successfulDeliveryKeys']) {
    if (!Array.isArray(value[key])) throw new Error('Invalid scheduler snapshot.');
  }
  return {
    config: normalizeStoredReminderConfig(value.config),
    students: value.students.map((student) => ({
      studentId: boundedText(student?.studentId),
      classId: boundedText(student?.classId, 32),
    })),
    completedStudentIds: value.completedStudentIds.map((studentId) => boundedText(studentId)),
    subscriptions: value.subscriptions.map((subscription) => ({
      ...normalizePushSubscription(subscription),
      studentId: boundedText(subscription?.studentId),
      subscriptionId: boundedText(subscription?.subscriptionId),
      sleepEnabled: subscription?.sleepEnabled === true,
      caffeineEnabled: subscription?.caffeineEnabled === true,
      active: subscription?.active === true,
    })),
    successfulDeliveryKeys: value.successfulDeliveryKeys.map((key) => boundedText(key, 1024)),
  };
}

async function schedulerCall(callGas, action, params) {
  const request = normalizeSchedulerRequest(action, params);
  return callGas({ role: 'scheduler', ...request });
}

function dueTypes(config, nowMs) {
  if (!config.enabled) return [];
  const { hour } = getKstClock(nowMs);
  return ['sleep', 'caffeine'].filter((type) => (
    config[`${type}Enabled`] && Number(config[`${type}Time`].slice(0, 2)) === hour
  ));
}

function publicType(types) {
  if (types.length === 0) return 'none';
  if (types.length === 2) return 'both';
  return types[0];
}

function safeDeliveryResult(result) {
  if (result?.status === 'success') return { status: 'success', errorCode: '' };
  if (result?.status === 'expired') {
    return { status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED' };
  }
  const errorCode = SAFE_ERROR_CODES.has(result?.errorCode) ? result.errorCode : 'PUSH_UNAVAILABLE';
  return { status: 'failed', errorCode };
}

async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(limit)));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function aggregate(type, targeted, skipped, results = []) {
  const counts = { sent: 0, expired: 0, failed: 0 };
  for (const result of results) {
    if (result.status === 'success') counts.sent += 1;
    if (result.status === 'expired') counts.expired += 1;
    if (result.status === 'failed') counts.failed += 1;
  }
  return { success: true, type, targeted, ...counts, skipped };
}

export function createReminderRunHandler({
  callGas = defaultCallGas,
  createSender = () => createPushSender(),
  getCronSecret = () => requireEnv('CRON_SECRET'),
  createExecutionId = () => randomUUID(),
  now = () => Math.floor(Date.now() / 1000),
  concurrency = 4,
  onScheduledTestEvent = event => console.info('scheduled_test_reminder_stage', JSON.stringify(event)),
} = {}) {
  return async function reminderRunHandler(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let secret;
    try { secret = getCronSecret(); } catch {
      sendJson(res, 500, { success: false, error: 'SERVER_MISCONFIGURED' });
      return;
    }
    if (!authorized(req, secret)) {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }

    const nowMs = now() * 1000;
    const nowIso = new Date(nowMs).toISOString();
    let scheduledTest;
    try { scheduledTest = scheduledTestRequest(req.url); } catch {
      sendJson(res, 400, { success: false, error: 'INVALID_SCHEDULED_TEST' });
      return;
    }
    try {
      if (scheduledTest) {
        const result = await runScheduledTestReminder({
          schedule: scheduledTest, nowMs, callGas, createSender, createExecutionId, onEvent: onScheduledTestEvent,
        });
        sendJson(res, 200, result);
        return;
      }
      const sleepSnapshot = normalizeSnapshot(await schedulerCall(
        callGas, 'getReminderDispatchSnapshot', ['sleep', nowIso],
      ));
      const types = dueTypes(sleepSnapshot.config, nowMs);
      if (types.length === 0) {
        sendJson(res, 200, aggregate('none', 0, 0));
        return;
      }

      const snapshots = new Map([['sleep', sleepSnapshot]]);
      if (types.includes('caffeine')) {
        snapshots.set('caffeine', normalizeSnapshot(await schedulerCall(
          callGas, 'getReminderDispatchSnapshot', ['caffeine', nowIso],
        )));
      }

      const candidates = types.flatMap((type) => selectReminderCandidates({
        type,
        nowMs,
        ...snapshots.get(type),
      }));
      if (candidates.length === 0) {
        sendJson(res, 200, aggregate(publicType(types), 0, 0));
        return;
      }

      const candidatesByKey = new Map(candidates.map((candidate) => [deliveryKey(candidate), candidate]));
      const requestedKeys = [...candidatesByKey.keys()];
      const claimedValue = await schedulerCall(callGas, 'claimReminderDeliveries', [
        requestedKeys, createExecutionId(), nowIso,
      ]);
      if (!Array.isArray(claimedValue)) throw new Error('Invalid scheduler claim response.');
      const claimedKeys = [];
      const seen = new Set();
      for (const value of claimedValue) {
        const key = boundedText(value, 1024);
        if (!candidatesByKey.has(key) || seen.has(key)) throw new Error('Invalid scheduler claim response.');
        seen.add(key);
        claimedKeys.push(key);
      }
      const claimed = claimedKeys.map((key) => candidatesByKey.get(key));
      const sender = claimed.length > 0 ? createSender() : null;
      const results = await mapConcurrent(claimed, concurrency, async (candidate) => {
        let delivery;
        try {
          delivery = safeDeliveryResult(await sender.send(
            { endpoint: candidate.endpoint, keys: candidate.keys },
            buildNotificationPayload(candidate),
          ));
        } catch {
          delivery = { status: 'failed', errorCode: 'PUSH_UNAVAILABLE' };
        }
        return {
          deliveryKey: deliveryKey(candidate),
          referenceDate: candidate.referenceDate,
          type: candidate.type,
          studentId: candidate.studentId,
          subscriptionId: candidate.subscriptionId,
          ...delivery,
        };
      });
      if (results.length > 0) {
        await schedulerCall(callGas, 'recordReminderDeliveryResults', [results]);
      }
      sendJson(res, 200, aggregate(
        publicType(types), candidates.length, candidates.length - claimed.length, results,
      ));
    } catch {
      sendJson(res, 502, { success: false, error: 'REMINDER_DISPATCH_FAILED' });
    }
  };
}

export default createReminderRunHandler();
