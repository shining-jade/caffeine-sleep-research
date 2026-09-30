import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getStudentBootstrapAction,
  loadStudentBootstrap,
  restoreStudentSession,
  shouldDeferStudentBootstrap,
} from '../public/js/student-startup.js';

test('valid session enters the app without showing login', async () => {
  const events = [];
  const session = { authenticated: true, studentId: '1101', name: '테스트학생' };

  const result = await restoreStudentSession({
    getSession: async () => session,
    onAuthenticated: async (value) => events.push(['app', value.studentId]),
    onUnauthenticated: () => events.push(['login']),
  });

  assert.equal(result.studentId, '1101');
  assert.deepEqual(events, [['app', '1101']]);
});

test('missing session shows login without entering stale student UI', async () => {
  const events = [];

  const result = await restoreStudentSession({
    getSession: async () => { throw new Error('unauthenticated'); },
    onAuthenticated: async () => events.push(['app']),
    onUnauthenticated: () => events.push(['login']),
  });

  assert.equal(result, null);
  assert.deepEqual(events, [['login']]);
});

test('bootstrap applies one combined response and does not call fallback', async () => {
  const events = [];
  const payload = {
    weight: { success: true, weight: 55 }, stats: { todayTotal: 10 },
    caffeineLogs: [], sleepLogs: [], sleepSettings: { success: true, settings: {} },
  };

  const result = await loadStudentBootstrap({
    requestBootstrap: async () => payload,
    applyBootstrap: (value) => events.push(['apply', value.stats.todayTotal]),
    fallback: () => events.push(['fallback']),
  });

  assert.equal(result, true);
  assert.deepEqual(events, [['apply', 10]]);
});

test('bootstrap failure invokes the legacy loaders exactly once', async () => {
  let fallbackCalls = 0;

  const result = await loadStudentBootstrap({
    requestBootstrap: async () => { throw new Error('gateway unavailable'); },
    applyBootstrap: () => assert.fail('not applied'),
    fallback: () => { fallbackCalls += 1; },
  });

  assert.equal(result, false);
  assert.equal(fallbackCalls, 1);
});

test('bootstrap waits only for active analysis or a returned camera file', () => {
  assert.equal(shouldDeferStudentBootstrap({ analyzingVisible: false, cameraHasFile: false }), false);
  assert.equal(shouldDeferStudentBootstrap({ analyzingVisible: true, cameraHasFile: false }), true);
  assert.equal(shouldDeferStudentBootstrap({ analyzingVisible: false, cameraHasFile: true }), true);
});

test('returned camera file starts analysis instead of waiting forever', () => {
  assert.equal(getStudentBootstrapAction({ analyzingVisible: false, cameraHasFile: false }), 'load');
  assert.equal(getStudentBootstrapAction({ analyzingVisible: true, cameraHasFile: true }), 'wait');
  assert.equal(getStudentBootstrapAction({ analyzingVisible: false, cameraHasFile: true }), 'analyze');
});
