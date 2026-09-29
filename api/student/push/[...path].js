import { sendJson } from '../../_lib/http.js';
import configHandler from '../../_lib/student/push/config.js';
import preferencesHandler from '../../_lib/student/push/preferences.js';
import subscribeHandler from '../../_lib/student/push/subscribe.js';
import unsubscribeHandler from '../../_lib/student/push/unsubscribe.js';

function routeName(req) {
  const value = req.query?.path;
  if (Array.isArray(value)) return value.join('/');
  if (value) return String(value);
  const pathname = String(req.url || '').split('?')[0];
  const prefix = '/api/student/push/';
  const index = pathname.indexOf(prefix);
  return index >= 0 ? decodeURIComponent(pathname.slice(index + prefix.length)).replace(/^\/+|\/+$/g, '') : '';
}

export function createStudentPushRouter({ handlers = {
  config: configHandler,
  preferences: preferencesHandler,
  subscribe: subscribeHandler,
  unsubscribe: unsubscribeHandler,
} } = {}) {
  return async function studentPushRouter(req, res) {
    const handler = handlers[routeName(req)];
    if (typeof handler !== 'function') {
      sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
      return;
    }
    await handler(req, res);
  };
}

export default createStudentPushRouter();
