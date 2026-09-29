import { readJson, sendJson } from '../../http.js';
import { getKstClock, previousKstDate } from '../../reminder-policy.js';
import { normalizePushSubscription } from '../../push-subscription.js';
import { buildNotificationPayload, createPushSender } from '../../web-push.js';
import { requireTeacherSession, sendReminderError } from './_shared.js';

export function createTestSendHandler({
  createSender = () => createPushSender(),
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function testSendHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try { requireTeacherSession(req, now()); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }
    let body;
    let subscription;
    try {
      body = await readJson(req);
      if ((body?.type !== 'sleep' && body?.type !== 'caffeine') || body?.studentId || body?.subscriptionId) {
        throw new Error('Invalid test push request.');
      }
      subscription = normalizePushSubscription(body.subscription);
    } catch (error) {
      sendReminderError(res, error, Number.isInteger(error?.status) ? error.status : 400);
      return;
    }
    try {
      const clock = getKstClock(now() * 1000);
      const referenceDate = body.type === 'sleep' ? previousKstDate(clock.date) : clock.date;
      const result = await createSender().send(
        subscription,
        buildNotificationPayload({ type: body.type, referenceDate }),
      );
      if (result.status !== 'success') {
        sendJson(res, result.status === 'expired' ? 410 : 502, {
          success: false, error: result.errorCode || 'PUSH_FAILED',
        });
        return;
      }
      sendJson(res, 200, { success: true, status: 'success' });
    } catch (error) {
      sendReminderError(res, error);
    }
  };
}

export default createTestSendHandler();
