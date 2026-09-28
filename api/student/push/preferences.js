import { callGas as defaultCallGas } from '../../_lib/gas.js';
import { readJson, sendJson } from '../../_lib/http.js';
import { normalizeSubscriptionId } from '../../_lib/push-subscription.js';
import { normalizeStudentRequest } from '../../_lib/student-policy.js';
import { readStudentSession, sendGatewayError, sendPushError } from './_shared.js';

function preferenceResponse(data, subscriptionId) {
  return {
    success: true,
    subscriptionId,
    sleepEnabled: data?.sleepEnabled === true,
    caffeineEnabled: data?.caffeineEnabled === true,
    active: data?.active === true,
  };
}

export function createPreferencesHandler({
  callGas = defaultCallGas,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function preferencesHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let session;
    try { session = readStudentSession(req, now()); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }
    let subscriptionId;
    let preferences;
    try {
      if (req.method === 'GET') {
        subscriptionId = normalizeSubscriptionId(req.headers?.['x-push-subscription-id']);
      } else {
        const body = await readJson(req);
        subscriptionId = normalizeSubscriptionId(body?.subscriptionId);
        if (typeof body?.sleepEnabled !== 'boolean' || typeof body?.caffeineEnabled !== 'boolean') {
          throw new Error('Invalid push preferences.');
        }
        preferences = { sleepEnabled: body.sleepEnabled, caffeineEnabled: body.caffeineEnabled };
      }
    } catch (error) {
      sendPushError(res, error);
      return;
    }
    try {
      const action = req.method === 'GET' ? 'getPushPreferences' : 'savePushPreferences';
      const params = req.method === 'GET' ? [subscriptionId] : [subscriptionId, preferences];
      const request = normalizeStudentRequest(action, params, session);
      const data = await callGas({ role: 'student', ...request });
      sendJson(res, 200, preferenceResponse(data, subscriptionId));
    } catch (error) {
      sendGatewayError(res, error);
    }
  };
}

export default createPreferencesHandler();
