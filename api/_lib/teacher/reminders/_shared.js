import { sendJson } from '../../http.js';
import { readSessionCookie, verifySession } from '../../session.js';

export function requireTeacherSession(req, nowSeconds) {
  return verifySession(readSessionCookie(req), 'teacher', nowSeconds);
}

export function sendReminderError(res, error, fallbackStatus = 500) {
  const status = Number.isInteger(error?.status) ? error.status : fallbackStatus;
  const code = typeof error?.code === 'string'
    ? error.code
    : (fallbackStatus === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR');
  sendJson(res, status, { success: false, error: code });
}
