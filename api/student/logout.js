import { callGas as defaultCallGas } from '../_lib/gas.js';
import { readJson, sendJson } from '../_lib/http.js';
import { subscriptionIdForEndpoint } from '../_lib/push-subscription.js';
import { clearSessionCookie, readSessionCookie, verifySession } from '../_lib/session.js';
import { normalizeStudentRequest } from '../_lib/student-policy.js';

export function createLogoutHandler({
  callGas = defaultCallGas,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function logoutHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      const session = verifySession(readSessionCookie(req), 'student', now());
      let body = null;
      try { body = await readJson(req); } catch { body = null; }
      if (body?.endpoint) {
        const subscriptionId = subscriptionIdForEndpoint(body.endpoint);
        const request = normalizeStudentRequest('deactivatePushSubscription', [subscriptionId], session);
        try { await callGas({ role: 'student', ...request }); } catch { /* Logout must still complete. */ }
      }
    } catch { /* An invalid session still receives a cleared cookie. */ }
    clearSessionCookie(res);
    sendJson(res, 200, { success: true });
  };
}

export default createLogoutHandler();
