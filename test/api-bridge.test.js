import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../public/js/api-bridge.js', import.meta.url), 'utf8');

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function loadBridge({ role = 'student', fetchImpl }) {
  const warnings = [];
  const window = {};
  const context = {
    window,
    document: { documentElement: { dataset: { appRole: role } } },
    fetch: fetchImpl,
    console: { log() {}, error() {}, warn: (...args) => warnings.push(args) },
    Error,
    Proxy,
    Promise,
    setTimeout,
    clearTimeout,
  };
  window.window = window;
  vm.runInNewContext(SOURCE, context, { filename: 'api-bridge.js' });
  return { window, warnings };
}

test('API bridge supports success and failure chaining', async () => {
  const { window } = loadBridge({
    fetchImpl: async () => response({ success: true, data: { total: 3 } }),
  });
  const success = await new Promise((resolve, reject) => {
    window.google.script.run
      .withFailureHandler(reject)
      .withSuccessHandler(resolve)
      .getStats('1101');
  });
  assert.equal(success.total, 3);

  const { window: failedWindow } = loadBridge({
    fetchImpl: async () => response({ success: false, error: 'DENIED' }, 403),
  });
  const error = await new Promise((resolve) => {
    failedWindow.google.script.run
      .withSuccessHandler(() => assert.fail('success handler must not run'))
      .withFailureHandler(resolve)
      .getStats('1101');
  });
  assert.equal(error.code, 'DENIED');
});

test('API bridge supports handler-less calls', async () => {
  const { window, warnings } = loadBridge({
    fetchImpl: async () => response({ success: false, error: 'FAILED' }, 500),
  });
  assert.doesNotThrow(() => window.google.script.run.getStats('1101'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(warnings.length, 1);
});

test('API bridge keeps concurrent call handlers isolated', async () => {
  const pending = [];
  const { window } = loadBridge({
    fetchImpl: () => new Promise((resolve) => pending.push(resolve)),
  });
  const results = [];
  window.google.script.run.withSuccessHandler((value) => results.push(`first:${value}`)).getStats('1');
  window.google.script.run.withSuccessHandler((value) => results.push(`second:${value}`)).getStats('2');

  pending[1](response({ success: true, data: 'B' }));
  pending[0](response({ success: true, data: 'A' }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(results.sort(), ['first:A', 'second:B']);
});

test('API bridge selects student and teacher action endpoints', async () => {
  for (const role of ['student', 'teacher']) {
    let captured;
    const { window } = loadBridge({
      role,
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return response({ success: true, data: true });
      },
    });
    await new Promise((resolve, reject) => {
      window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getStats('1101');
    });
    assert.equal(captured.url, `/api/${role}/action`);
    assert.equal(captured.options.credentials, 'same-origin');
    assert.equal(captured.options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(captured.options.body), { action: 'getStats', params: ['1101'] });
  }
});

test('API bridge auth helpers use login session and logout routes', async () => {
  const calls = [];
  const { window } = loadBridge({
    role: 'teacher',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response({ success: true, authenticated: true, role: 'teacher' });
    },
  });

  await window.appAuth.loginTeacher('password-value');
  await window.appAuth.getSession();
  await window.appAuth.logout();

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/teacher/login', '/api/teacher/session', '/api/teacher/logout',
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.body), { password: 'password-value' });
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[2].options.method, 'POST');
});

test('API bridge student login sends only student credentials', async () => {
  let captured;
  const { window } = loadBridge({
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ success: true, authenticated: true, role: 'student' });
    },
  });
  await window.appAuth.loginStudent('1101', '테스트학생');
  assert.equal(captured.url, '/api/student/login');
  assert.deepEqual(JSON.parse(captured.options.body), { studentId: '1101', name: '테스트학생' });
});

test('API bridge invokes session expiry callback on 401', async () => {
  const { window } = loadBridge({
    fetchImpl: async () => response({ success: false, error: 'UNAUTHENTICATED' }, 401),
  });
  let expired = 0;
  window.appAuth.onSessionExpired(() => { expired += 1; });
  await new Promise((resolve) => {
    window.google.script.run.withFailureHandler(resolve).getStats('1101');
  });
  assert.equal(expired, 1);
});

test('API bridge rejects malformed JSON responses safely', async () => {
  const { window } = loadBridge({
    fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new Error('private html'); } }),
  });
  const error = await new Promise((resolve) => {
    window.google.script.run.withFailureHandler(resolve).getStats('1101');
  });
  assert.equal(error.code, 'INVALID_RESPONSE');
  assert.equal(error.message.includes('private html'), false);
});

test('API bridge public source contains no upstream URL or secret names', () => {
  assert.doesNotMatch(SOURCE, /script\.google\.com\/macros\/s\//i);
  assert.doesNotMatch(SOURCE, /GAS_API_URL|GAS_SHARED_SECRET|SESSION_SECRET|TEACHER_PASSWORD_HASH/);
});
