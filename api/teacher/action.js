import { callGas as defaultCallGas } from '../_lib/gas.js';
import { DEFAULT_MAX_BYTES, readJson, sendJson } from '../_lib/http.js';
import { readSessionCookie, verifySession } from '../_lib/session.js';
import { normalizeTeacherRequest } from '../_lib/teacher-policy.js';

// Chart images are embedded in PDF HTML; stay below Vercel's 4.5 MB request limit.
const PDF_MAX_BYTES = 4 * 1024 * 1024;

export function createActionHandler({
  callGas = defaultCallGas,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function actionHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      verifySession(readSessionCookie(req, "teacher"), 'teacher', now());
    } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }

    let body;
    try {
      body = await readJson(req, {
        maxBytes: PDF_MAX_BYTES,
        maxBytesForBody: (value) => value?.action === 'saveTeacherPdfAndSendMessage'
          ? PDF_MAX_BYTES : DEFAULT_MAX_BYTES,
      });
    } catch (error) {
      sendJson(res, error.status || 400, { success: false, error: error.code || 'INVALID_REQUEST' });
      return;
    }

    let normalized;
    try {
      normalized = normalizeTeacherRequest(body?.action, body?.params);
    } catch (error) {
      sendJson(res, error?.code === 'INVALID_INPUT' ? 400 : 403, { success: false, error: error?.code === 'INVALID_INPUT' ? 'INVALID_INPUT' : 'ACTION_NOT_ALLOWED' });
      return;
    }

    try {
      const data = await callGas({ role: 'teacher', ...normalized });
      sendJson(res, 200, { success: true, data });
    } catch (error) {
      sendJson(res, error?.status || 500, {
        success: false,
        error: typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR',
      });
    }
  };
}

export default createActionHandler();
