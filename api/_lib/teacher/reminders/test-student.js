import { randomUUID } from 'node:crypto';

import { callGas as defaultCallGas } from '../../gas.js';
import { readJson, sendJson } from '../../http.js';
import { getKstClock, previousKstDate } from '../../reminder-policy.js';
import {
  normalizePushSubscription,
  normalizeSubscriptionId,
  subscriptionIdForEndpoint,
} from '../../push-subscription.js';
import { normalizeTeacherRequest } from '../../teacher-policy.js';
import { buildNotificationPayload, createPushSender } from '../../web-push.js';
import { requireTeacherSession, sendReminderError } from './_shared.js';

const TYPES = new Set(['sleep', 'caffeine']);
const SAFE_ERROR_CODES = new Set([
  'PUSH_SUBSCRIPTION_EXPIRED', 'PUSH_RATE_LIMITED', 'PUSH_SERVER_ERROR',
  'PUSH_REJECTED', 'PUSH_UNAVAILABLE',
]);

function nonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function safeStatus(value) {
  return {
    name: '테스트',
    sleepDevices: nonnegative(value?.sleepDevices),
    caffeineDevices: nonnegative(value?.caffeineDevices),
  };
}

function requireSendBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid test student request.');
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'type' || !TYPES.has(value.type)) {
    throw new Error('Invalid test student request.');
  }
  return value.type;
}

function normalizeTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid test student target.');
  const studentId = typeof value.studentId === 'string' ? value.studentId.trim() : String(value.studentId ?? '').trim();
  if (!studentId || studentId.length > 128) throw new Error('Invalid test student target.');
  const subscriptionId = normalizeSubscriptionId(value.subscriptionId);
  const subscription = normalizePushSubscription(value);
  if (subscriptionIdForEndpoint(subscription.endpoint) !== subscriptionId) throw new Error('Invalid test student target.');
  return { studentId, subscriptionId, subscription };
}

function safeDelivery(value) {
  if (value?.status === 'success') return { status: 'success', errorCode: '' };
  if (value?.status === 'expired') return { status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED' };
  const errorCode = SAFE_ERROR_CODES.has(value?.errorCode) ? value.errorCode : 'PUSH_UNAVAILABLE';
  return { status: 'failed', errorCode };
}

export function createTestStudentHandler({
  callGas = defaultCallGas,
  createSender = () => createPushSender(),
  now = () => Math.floor(Date.now() / 1000),
  randomId = randomUUID,
} = {}) {
  return async function testStudentHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try { requireTeacherSession(req, now()); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }

    if (req.method === 'GET') {
      try {
        const request = normalizeTeacherRequest('getTestStudentReminderStatus', []);
        const data = await callGas({ role: 'teacher', ...request });
        sendJson(res, 200, { success: true, ...safeStatus(data) });
      } catch (error) {
        sendReminderError(res, error);
      }
      return;
    }

    let type;
    try { type = requireSendBody(await readJson(req)); } catch (error) {
      sendReminderError(res, error, 400);
      return;
    }

    try {
      const targetRequest = normalizeTeacherRequest('getTestStudentReminderTargets', [type]);
      const snapshot = await callGas({ role: 'teacher', ...targetRequest });
      if (!Array.isArray(snapshot?.subscriptions) || snapshot.subscriptions.length > 100) {
        throw new Error('Invalid test student target response.');
      }
      const targets = snapshot.subscriptions.map(normalizeTarget);
      const requestId = String(randomId()).trim();
      if (!/^[A-Za-z0-9-]{1,64}$/.test(requestId)) throw new Error('Invalid test request identifier.');
      const clock = getKstClock(now() * 1000);
      const referenceDate = type === 'sleep' ? previousKstDate(clock.date) : clock.date;
      const payload = buildNotificationPayload({ type, referenceDate });
      const sender = createSender();
      const results = await Promise.all(targets.map(async (target) => {
        let delivery;
        try { delivery = safeDelivery(await sender.send(target.subscription, payload)); }
        catch { delivery = { status: 'failed', errorCode: 'PUSH_UNAVAILABLE' }; }
        return {
          deliveryKey: `manual-test:${requestId}:${type}:${target.subscriptionId}`,
          studentId: target.studentId,
          subscriptionId: target.subscriptionId,
          ...delivery,
        };
      }));
      if (results.length) {
        const recordRequest = normalizeTeacherRequest(
          'recordTestStudentReminderResults', [type, referenceDate, results],
        );
        await callGas({ role: 'teacher', ...recordRequest });
      }
      const counts = { sent: 0, expired: 0, failed: 0 };
      for (const result of results) {
        if (result.status === 'success') counts.sent += 1;
        else if (result.status === 'expired') counts.expired += 1;
        else counts.failed += 1;
      }
      sendJson(res, 200, {
        success: true,
        type,
        targeted: targets.length,
        ...counts,
      });
    } catch (error) {
      sendReminderError(res, error);
    }
  };
}

export default createTestStudentHandler();
