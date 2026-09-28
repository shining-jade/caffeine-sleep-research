import { callGas as defaultCallGas } from '../../gas.js';
import { readJson, sendJson } from '../../http.js';
import { normalizePushSubscription, subscriptionIdForEndpoint } from '../../push-subscription.js';
import { normalizeTeacherRequest } from '../../teacher-policy.js';
import { requireTeacherSession, sendReminderError } from './_shared.js';

export function createTestSubscribeHandler({
  callGas = defaultCallGas,
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
    try {
      const payload = { ...subscription, role: 'teacher-test', sleepEnabled: false, caffeineEnabled: false };
      const request = normalizeTeacherRequest('saveTeacherTestSubscription', [payload]);
      const data = await callGas({ role: 'teacher', ...request });
      const subscriptionId = subscriptionIdForEndpoint(subscription.endpoint);
      if (data?.subscriptionId !== subscriptionId) throw new Error('Invalid gateway result.');
      sendJson(res, 200, { success: true, subscriptionId });
    } catch (error) {
      sendReminderError(res, error);
    }
  };
}

export default createTestSubscribeHandler();
