import { getRuntimeConfig } from '../_lib/env.js';
import { readJson, sendJson } from '../_lib/http.js';
import { verifyTeacherPassword } from '../_lib/password.js';
import { createSession, setSessionCookie } from '../_lib/session.js';
import { checkLoginRateLimit } from '../_lib/rate-limit.js';

const SESSION_SECONDS = 8 * 60 * 60;

export function createLoginHandler({
  verifyPassword = verifyTeacherPassword,
  checkRateLimit = (req) => checkLoginRateLimit(req, 'teacher-login', { max: 8 }),
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
      sendJson(res, error.status || 400, { success: false, error: error.code || 'INVALID_REQUEST' });
      return;
    }

    const password = typeof body?.password === 'string' ? body.password : '';
    const config = getRuntimeConfig();
    const valid = await verifyPassword(
      password,
      config.teacherPasswordSalt,
      config.teacherPasswordHash,
    );
    if (!valid) {
      sendJson(res, 401, { success: false, error: 'INVALID_CREDENTIALS' });
      return;
    }

    const issuedAt = now();
    const token = createSession({ role: 'teacher', exp: issuedAt + SESSION_SECONDS }, issuedAt);
    setSessionCookie(res, token, SESSION_SECONDS);
    sendJson(res, 200, { success: true, authenticated: true, role: 'teacher' });
  };
}

export default createLoginHandler();
