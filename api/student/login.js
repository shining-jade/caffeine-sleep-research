import { callGas as defaultCallGas } from '../_lib/gas.js';
import { readJson, sendJson } from '../_lib/http.js';
import { createSession, setSessionCookie, STUDENT_SESSION_SECONDS } from '../_lib/session.js';
import { checkLoginRateLimit } from '../_lib/rate-limit.js';

function sendKnownError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  sendJson(res, status, { success: false, error: code });
}

export function createLoginHandler({
  callGas = defaultCallGas,
  checkRateLimit = (req) => checkLoginRateLimit(req, 'student-login', { max: 12 }),
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function loginHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    const rate = checkRateLimit(req);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfter));
      sendJson(res, 429, { success: false, error: 'TOO_MANY_REQUESTS' });
      return;
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      sendKnownError(res, error);
      return;
    }

    const studentId = typeof body?.studentId === 'string' ? body.studentId.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!studentId || !name) {
      sendJson(res, 401, { success: false, error: 'INVALID_CREDENTIALS' });
      return;
    }

    try {
      const result = await callGas({
        role: 'public',
        action: 'checkLogin',
        params: [studentId, name],
        subject: null,
      });
      const normalizedId = typeof result?.studentId === 'string' ? result.studentId.trim() : '';
      const normalizedName = typeof result?.name === 'string' ? result.name.trim() : '';
      if (result?.success !== true || !normalizedId || !normalizedName) {
        sendJson(res, 401, { success: false, error: 'INVALID_CREDENTIALS' });
        return;
      }

      const issuedAt = now();
      const token = createSession({
        role: 'student',
        studentId: normalizedId,
        name: normalizedName,
        exp: issuedAt + STUDENT_SESSION_SECONDS,
      }, issuedAt);
      setSessionCookie(res, token, STUDENT_SESSION_SECONDS, "student");
      sendJson(res, 200, {
        success: true,
        authenticated: true,
        role: 'student',
        studentId: normalizedId,
        name: normalizedName,
      });
    } catch (error) {
      if (error?.code) sendKnownError(res, error);
      else sendJson(res, 500, { success: false, error: 'INTERNAL_ERROR' });
    }
  };
}

export default createLoginHandler();
