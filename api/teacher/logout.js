import { sendJson } from '../_lib/http.js';
import { clearSessionCookie } from '../_lib/session.js';

export function createLogoutHandler() {
  return async function logoutHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    clearSessionCookie(res);
    sendJson(res, 200, { success: true });
  };
}

export default createLogoutHandler();
