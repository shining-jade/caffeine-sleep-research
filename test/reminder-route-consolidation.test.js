import assert from 'node:assert/strict';
import test from 'node:test';

import { createStudentPushRouter } from '../api/student/push/[...path].js';
import { createTeacherReminderRouter } from '../api/teacher/reminders/[...path].js';

function response() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(value = '') { this.body = value; },
    json() { return JSON.parse(this.body); },
  };
}

test('student push catch-all preserves each public endpoint path', async () => {
  const calls = [];
  const handlers = Object.fromEntries(
    ['config', 'preferences', 'subscribe', 'unsubscribe'].map((name) => [
      name,
      async () => calls.push(name),
    ]),
  );
  const router = createStudentPushRouter({ handlers });
  for (const name of Object.keys(handlers)) await router({ query: { path: [name] } }, response());
  assert.deepEqual(calls, ['config', 'preferences', 'subscribe', 'unsubscribe']);
});

test('teacher reminder catch-all preserves config current-device and test-student paths', async () => {
  const calls = [];
  const handlers = Object.fromEntries(
    ['config', 'test-subscribe', 'test-send', 'test-student'].map((name) => [
      name,
      async () => calls.push(name),
    ]),
  );
  const router = createTeacherReminderRouter({ handlers });
  for (const name of Object.keys(handlers)) await router({ query: { path: name } }, response());
  assert.deepEqual(calls, ['config', 'test-subscribe', 'test-send', 'test-student']);
});

test('catch-all routers recover the endpoint from req.url when Vercel omits the path query', async () => {
  const calls = [];
  const studentRouter = createStudentPushRouter({
    handlers: { config: async () => calls.push('student-config') },
  });
  const teacherRouter = createTeacherReminderRouter({
    handlers: { config: async () => calls.push('teacher-config') },
  });

  await studentRouter({ url: '/api/student/push/config?source=preview', query: {} }, response());
  await teacherRouter({ url: '/api/teacher/reminders/config', query: {} }, response());

  assert.deepEqual(calls, ['student-config', 'teacher-config']);
});

test('consolidated reminder routes fail closed for unknown nested paths', async () => {
  for (const router of [createStudentPushRouter(), createTeacherReminderRouter()]) {
    const res = response();
    await router({ query: { path: ['unknown', 'nested'] } }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { success: false, error: 'NOT_FOUND' });
  }
});
