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
      verifySession(readSessionCookie(req, "teacher"), 'teacher', now());
      sendJson(res, 200, { authenticated: true, role: 'teacher' });
    } catch {
      clearSessionCookie(res, "teacher", req);
      sendJson(res, 401, { authenticated: false });
    }
  };
}

export default createSessionHandler();
