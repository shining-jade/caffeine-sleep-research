import { sendJson } from '../../_lib/http.js';
import configHandler from '../../_lib/teacher/reminders/config.js';
import testSendHandler from '../../_lib/teacher/reminders/test-send.js';
import testStudentHandler from '../../_lib/teacher/reminders/test-student.js';
import testSubscribeHandler from '../../_lib/teacher/reminders/test-subscribe.js';

function routeName(req) {
  const value = req.query?.path;
  if (Array.isArray(value)) return value.join('/');
  if (value) return String(value);
  const pathname = String(req.url || '').split('?')[0];
  const prefix = '/api/teacher/reminders/';
  const index = pathname.indexOf(prefix);
  return index >= 0 ? decodeURIComponent(pathname.slice(index + prefix.length)).replace(/^\/+|\/+$/g, '') : '';
}

export function createTeacherReminderRouter({ handlers = {
  config: configHandler,
  'test-send': testSendHandler,
  'test-student': testStudentHandler,
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
