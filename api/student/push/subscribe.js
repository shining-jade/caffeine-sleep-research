import { callGas as defaultCallGas } from '../../_lib/gas.js';
import { readJson, sendJson } from '../../_lib/http.js';
import { normalizePushSubscription, subscriptionIdForEndpoint } from '../../_lib/push-subscription.js';
import { normalizeStudentRequest } from '../../_lib/student-policy.js';
import { readStudentSession, sendGatewayError, sendPushError } from './_shared.js';

export function createSubscribeHandler({
  callGas = defaultCallGas,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function subscribeHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let session;
    try { session = readStudentSession(req, now()); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }
    let body;
    let subscription;
    try {
      body = await readJson(req);
      subscription = normalizePushSubscription(body?.subscription);
      if (typeof body?.sleepEnabled !== 'boolean' || typeof body?.caffeineEnabled !== 'boolean') {
        throw new Error('Invalid push preferences.');
      }
    } catch (error) {
      sendPushError(res, error);
      return;
    }
    try {
      const request = normalizeStudentRequest('savePushSubscription', [{
        ...subscription,
        sleepEnabled: body.sleepEnabled,
        caffeineEnabled: body.caffeineEnabled,
      }], session);
      const data = await callGas({ role: 'student', ...request });
      const expectedId = subscriptionIdForEndpoint(subscription.endpoint);
      if (data?.subscriptionId !== expectedId) throw new Error('Invalid gateway result.');
      sendJson(res, 200, { success: true, subscriptionId: expectedId });
    } catch (error) {
      sendGatewayError(res, error);
    }
  };
}

export default createSubscribeHandler();
