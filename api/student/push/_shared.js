import { sendJson } from '../../_lib/http.js';
import { readSessionCookie, verifySession } from '../../_lib/session.js';

export function readStudentSession(req, nowSeconds) {
  return verifySession(readSessionCookie(req), 'student', nowSeconds);
}

export function sendPushError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 400;
  const code = typeof error?.code === 'string' ? error.code : 'INVALID_REQUEST';
  sendJson(res, status, { success: false, error: code });
}

export function sendGatewayError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  sendJson(res, status, { success: false, error: code });
}
