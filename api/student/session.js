import { sendJson } from '../_lib/http.js';
import {
  clearSessionCookie,
  readSessionCookie,
  verifySession,
} from '../_lib/session.js';

export function createSessionHandler({
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function sessionHandler(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { authenticated: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      const session = verifySession(readSessionCookie(req), 'student', now());
      sendJson(res, 200, {
        authenticated: true,
        role: 'student',
        studentId: session.studentId,
        name: session.name,
      });
    } catch {
      clearSessionCookie(res);
      sendJson(res, 401, { authenticated: false });
    }
  };
}

export default createSessionHandler();
