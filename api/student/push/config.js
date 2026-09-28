import { getPushRuntimeConfig } from '../../_lib/env.js';
import { callGas as defaultCallGas } from '../../_lib/gas.js';
import { sendJson } from '../../_lib/http.js';
import { normalizeStudentRequest } from '../../_lib/student-policy.js';
import { readStudentSession, sendGatewayError } from './_shared.js';

export function createConfigHandler({
  callGas = defaultCallGas,
  getPushConfig = getPushRuntimeConfig,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function configHandler(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let session;
    try { session = readStudentSession(req, now()); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }
    try {
      const request = normalizeStudentRequest('getReminderStudentConfig', [], session);
      const data = await callGas({ role: 'student', ...request });
      const { publicKey } = getPushConfig();
      sendJson(res, 200, {
        success: true,
        publicKey,
        sleepTime: String(data?.sleepTime || ''),
        caffeineTime: String(data?.caffeineTime || ''),
        globallyEnabled: data?.globallyEnabled === true,
      });
    } catch (error) {
      sendGatewayError(res, error);
    }
  };
}

export default createConfigHandler();
