import { getKstClock, previousKstDate } from './reminder-policy.js';
import { normalizeSchedulerRequest } from './scheduler-policy.js';
import { normalizeTeacherRequest } from './teacher-policy.js';
import { normalizeTestStudentTarget } from './teacher/reminders/test-student.js';
import { buildNotificationPayload } from './web-push.js';

// Temporary physical-device audit. An exact date AND hour prevent future daily
// cron invocations from sending again. This never changes the school schedule.
export const SCHEDULED_TEST_REMINDER = Object.freeze({
  id: '20261010-sleep-03', date: '2026-10-10', hour: 3, type: 'sleep', studentId: '0',
});

const SAFE_ERROR_CODES = new Set([
  'PUSH_SUBSCRIPTION_EXPIRED', 'PUSH_RATE_LIMITED', 'PUSH_SERVER_ERROR',
  'PUSH_REJECTED', 'PUSH_UNAVAILABLE',
]);

export function scheduledTestRequest(url = '/') {
  const ids = new URL(url, 'https://caffeine-sleep-research.vercel.app').searchParams.getAll('scheduledTest');
  if (!ids.length) return null;
  if (ids.length !== 1 || ids[0] !== SCHEDULED_TEST_REMINDER.id) throw new Error('Invalid scheduled test.');
  return SCHEDULED_TEST_REMINDER;
}

function safeDelivery(value) {
  if (value?.status === 'success') return { status: 'success', errorCode: '' };
  if (value?.status === 'expired') return { status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED' };
  return { status: 'failed', errorCode: SAFE_ERROR_CODES.has(value?.errorCode) ? value.errorCode : 'PUSH_UNAVAILABLE' };
}

export async function runScheduledTestReminder({ schedule, nowMs, callGas, createSender, createExecutionId }) {
  const clock = getKstClock(nowMs);
  const aggregate = { success: true, type: schedule.type, scheduledTest: schedule.id,
    targeted: 0, sent: 0, expired: 0, failed: 0, skipped: 0 };
  if (clock.date !== schedule.date || clock.hour !== schedule.hour) return aggregate;

  const request = normalizeTeacherRequest('getTestStudentReminderTargets', [schedule.type]);
  const snapshot = await callGas({ role: 'teacher', ...request });
  if (snapshot?.name !== '테스트' || !Array.isArray(snapshot.subscriptions) || snapshot.subscriptions.length > 100) {
    throw new Error('Invalid scheduled test target response.');
  }
  const targetsByKey = new Map();
  for (const value of snapshot.subscriptions) {
    // The gateway already resolves the exact test name. Also require the
    // specifically authorized account ID, so a renamed student cannot be sent.
    if (String(value?.studentId ?? '').trim() !== schedule.studentId) continue;
    const target = normalizeTestStudentTarget(value);
    targetsByKey.set(`scheduled-test:${schedule.id}:${target.subscriptionId}`, target);
  }
  aggregate.targeted = targetsByKey.size;
  if (!aggregate.targeted) return aggregate;

  const claimRequest = normalizeSchedulerRequest('claimReminderDeliveries', [
    [...targetsByKey.keys()], createExecutionId(), new Date(nowMs).toISOString(),
  ]);
  const claimed = await callGas({ role: 'scheduler', ...claimRequest });
  if (!Array.isArray(claimed) || new Set(claimed).size !== claimed.length
      || claimed.some(key => !targetsByKey.has(key))) throw new Error('Invalid scheduled test claims.');
  aggregate.skipped = aggregate.targeted - claimed.length;
  if (!claimed.length) return aggregate;

  const referenceDate = schedule.type === 'sleep' ? previousKstDate(clock.date) : clock.date;
  const payload = buildNotificationPayload({ type: schedule.type, referenceDate });
  const sender = createSender();
  const results = await Promise.all(claimed.map(async (key) => {
    const target = targetsByKey.get(key);
    let delivery;
    try { delivery = safeDelivery(await sender.send(target.subscription, payload)); }
    catch { delivery = { status: 'failed', errorCode: 'PUSH_UNAVAILABLE' }; }
    if (delivery.status === 'success') aggregate.sent += 1;
    else if (delivery.status === 'expired') aggregate.expired += 1;
    else aggregate.failed += 1;
    return { deliveryKey: key, referenceDate, type: schedule.type,
      studentId: target.studentId, subscriptionId: target.subscriptionId, ...delivery };
  }));
  const recordRequest = normalizeSchedulerRequest('recordReminderDeliveryResults', [results]);
  try { await callGas({ role: 'scheduler', ...recordRequest }); }
  catch { aggregate.logSaved = false; }
  // Non-sensitive operational evidence is visible in automatic Cron logs.
  console.info('scheduled_test_reminder_result', JSON.stringify(aggregate));
  return aggregate;
}
