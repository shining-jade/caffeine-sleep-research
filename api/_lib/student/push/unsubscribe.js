import { callGas as defaultCallGas } from '../../gas.js';
import { readJson, sendJson } from '../../http.js';
import { normalizeSubscriptionId, subscriptionIdForEndpoint } from '../../push-subscription.js';
import { normalizeStudentRequest } from '../../student-policy.js';
import { readStudentSession, sendGatewayError, sendPushError } from './_shared.js';

export function createUnsubscribeHandler({
  callGas = defaultCallGas,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function unsubscribeHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let session;
    try { session = readStudentSession(req, now()); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }
    let subscriptionId;
    try {
      const body = await readJson(req);
      subscriptionId = body?.subscriptionId
        ? normalizeSubscriptionId(body.subscriptionId)
        : subscriptionIdForEndpoint(body?.endpoint);
    } catch (error) {
      sendPushError(res, error);
      return;
    }
    try {
      const request = normalizeStudentRequest('deactivatePushSubscription', [subscriptionId], session);
      await callGas({ role: 'student', ...request });
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendGatewayError(res, error);
    }
  };
}

export default createUnsubscribeHandler();
