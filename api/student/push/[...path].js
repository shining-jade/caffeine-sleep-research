import { sendJson } from '../../_lib/http.js';
import configHandler from '../../_lib/student/push/config.js';
import preferencesHandler from '../../_lib/student/push/preferences.js';
import subscribeHandler from '../../_lib/student/push/subscribe.js';
import unsubscribeHandler from '../../_lib/student/push/unsubscribe.js';

function routeName(req) {
  const value = req.query?.path;
  return Array.isArray(value) ? value.join('/') : String(value || '');
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
