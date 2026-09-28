import { sendJson } from '../../_lib/http.js';
import configHandler from '../../_lib/teacher/reminders/config.js';
import testSendHandler from '../../_lib/teacher/reminders/test-send.js';
import testSubscribeHandler from '../../_lib/teacher/reminders/test-subscribe.js';

function routeName(req) {
  const value = req.query?.path;
  return Array.isArray(value) ? value.join('/') : String(value || '');
}

export function createTeacherReminderRouter({ handlers = {
  config: configHandler,
  'test-send': testSendHandler,
  'test-subscribe': testSubscribeHandler,
} } = {}) {
  return async function teacherReminderRouter(req, res) {
    const handler = handlers[routeName(req)];
    if (typeof handler !== 'function') {
      sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
      return;
    }
    await handler(req, res);
  };
}

export default createTeacherReminderRouter();
