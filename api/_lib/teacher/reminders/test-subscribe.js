import { readJson, sendJson } from '../../http.js';
import { normalizePushSubscription, subscriptionIdForEndpoint } from '../../push-subscription.js';
import { requireTeacherSession, sendReminderError } from './_shared.js';

export function createTestSubscribeHandler({
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function testSubscribeHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try { requireTeacherSession(req, now()); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }
    let subscription;
    try { subscription = normalizePushSubscription((await readJson(req))?.subscription); } catch (error) {
      sendReminderError(res, error, Number.isInteger(error?.status) ? error.status : 400);
      return;
    }
    sendJson(res, 200, {
      success: true,
      subscriptionId: subscriptionIdForEndpoint(subscription.endpoint),
    });
  };
}

export default createTestSubscribeHandler();
