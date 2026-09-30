import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createActionHandler } from '../api/student/action.js';
import { createLoginHandler } from '../api/student/login.js';
import { createLogoutHandler } from '../api/student/logout.js';
import { createSessionHandler } from '../api/student/session.js';
import { GasGatewayError } from '../api/_lib/gas.js';
import { createSession, verifySession } from '../api/_lib/session.js';

process.env.SESSION_SECRET = 'student-api-test-session-secret';
process.env.GAS_API_URL = 'https://example.invalid/gas';
process.env.GAS_SHARED_SECRET = 'gateway-secret';
process.env.TEACHER_PASSWORD_SALT = '00'.repeat(16);
process.env.TEACHER_PASSWORD_HASH = '11'.repeat(64);

const NOW = 1_800_000_000;

function request(method, body, cookie = '') {
  const chunks = body === undefined ? [] : [Buffer.from(body)];
  const req = Readable.from(chunks);
  req.method = method;
  req.headers = cookie ? { cookie } : {};
  return req;
}

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    getHeader(name) { return headers.get(name.toLowerCase()); },
    end(value = '') { this.body = value; },
    json() { return JSON.parse(this.body); },
  };
}

function studentCookie(overrides = {}) {
  const payload = {
    role: 'student',
    studentId: '1101',
    name: '테스트학생',
    exp: NOW + 3600,
    ...overrides,
  };
  const token = createSession(payload, Math.min(NOW, payload.exp - 1));
  return `caffeine_session=${encodeURIComponent(token)}`;
}

test('student API rejects unsupported login method', async () => {
  const res = response();
  await createLoginHandler({ callGas: async () => assert.fail('not called'), now: () => NOW })(
    request('GET'), res,
  );
  assert.equal(res.statusCode, 405);
  assert.equal(res.json().error, 'METHOD_NOT_ALLOWED');
});

test('student API rejects malformed and oversized login bodies', async () => {
  const handler = createLoginHandler({ callGas: async () => assert.fail('not called'), now: () => NOW });
  const malformed = response();
  await handler(request('POST', '{bad'), malformed);
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error, 'INVALID_JSON');

  const oversized = response();
  await handler(request('POST', JSON.stringify({ value: 'x'.repeat(256 * 1024) })), oversized);
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.json().error, 'PAYLOAD_TOO_LARGE');
});

test('student API returns generic invalid login response', async () => {
  const handler = createLoginHandler({
    callGas: async () => ({ success: false, message: 'private detail' }),
    now: () => NOW,
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ studentId: '9999', name: '누군가' })), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { success: false, error: 'INVALID_CREDENTIALS' });
  assert.equal(res.getHeader('set-cookie'), undefined);
});

test('student login is rate limited before checking the roster', async () => {
  let calls = 0;
  const handler = createLoginHandler({
    callGas: async () => { calls += 1; },
    checkRateLimit: () => ({ allowed: false, retryAfter: 60 }),
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ studentId: '1101', name: '학생' })), res);
  assert.equal(res.statusCode, 429);
  assert.equal(calls, 0);
});

test('student API issues secure cookie after valid login', async () => {
  let forwarded;
  const handler = createLoginHandler({
    callGas: async (input) => {
      forwarded = input;
      return { success: true, studentId: '1101', name: '테스트학생' };
    },
    now: () => NOW,
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ studentId: '1101', name: '테스트학생' })), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(forwarded, {
    role: 'public', action: 'checkLogin', params: ['1101', '테스트학생'], subject: null,
  });
  const setCookie = res.getHeader('set-cookie');
  assert.match(setCookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(setCookie, /Max-Age=7776000/);
  const token = decodeURIComponent(setCookie.match(/^caffeine_session=([^;]+)/)[1]);
  assert.equal(verifySession(token, 'student', NOW + 7_775_999).studentId, '1101');
  assert.throws(() => verifySession(token, 'student', NOW + 7_776_000), /expired session/i);
  assert.deepEqual(res.json(), {
    success: true, authenticated: true, role: 'student', studentId: '1101', name: '테스트학생',
  });
});

test('student API denies missing tampered and expired sessions before gateway call', async () => {
  let calls = 0;
  const handler = createActionHandler({ callGas: async () => { calls += 1; }, now: () => NOW });
  const cookies = [
    '',
    `${studentCookie()}x`,
    studentCookie({ exp: NOW - 1 }),
  ];

  for (const cookie of cookies) {
    const res = response();
    await handler(request('POST', JSON.stringify({ action: 'getStats', params: ['9999'] }), cookie), res);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(calls, 0);
});

test('student API rejects teacher-only action before gateway call', async () => {
  let calls = 0;
  const handler = createActionHandler({ callGas: async () => { calls += 1; }, now: () => NOW });
  const res = response();
  await handler(
    request('POST', JSON.stringify({ action: 'getTeacherData', params: [] }), studentCookie()),
    res,
  );
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'ACTION_NOT_ALLOWED');
  assert.equal(calls, 0);
});

test('student API forwards successful action with session identity only', async () => {
  let forwarded;
  const handler = createActionHandler({
    callGas: async (input) => { forwarded = input; return { saved: true }; },
    now: () => NOW,
  });
  const res = response();
  await handler(request('POST', JSON.stringify({
    action: 'saveCaffeineData',
    params: [{ studentId: '9999', name: '다른학생', mg: 40 }],
  }), studentCookie()), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(forwarded.subject, { studentId: '1101', name: '테스트학생' });
  assert.deepEqual(forwarded.params, [{ studentId: '1101', name: '테스트학생', mg: 40 }]);
  assert.equal(JSON.stringify(forwarded).includes('9999'), false);
  assert.deepEqual(res.json(), { success: true, data: { saved: true } });
});

test('student API maps upstream failure safely', async () => {
  const handler = createActionHandler({
    callGas: async () => { throw new GasGatewayError(504, 'GAS_TIMEOUT', 'safe'); },
    now: () => NOW,
  });
  const res = response();
  await handler(
    request('POST', JSON.stringify({ action: 'getStats', params: ['1101'] }), studentCookie()),
    res,
  );
  assert.equal(res.statusCode, 504);
  assert.deepEqual(res.json(), { success: false, error: 'GAS_TIMEOUT' });
});

test('student API session inspection never returns token', async () => {
  const res = response();
  await createSessionHandler({ now: () => NOW })(request('GET', undefined, studentCookie()), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    authenticated: true, role: 'student', studentId: '1101', name: '테스트학생',
  });
  assert.equal(res.body.includes('caffeine_session'), false);
});

test('student API session inspection renews the same student session for 90 days', async () => {
  const res = response();
  await createSessionHandler({ now: () => NOW })(request('GET', undefined, studentCookie()), res);

  const setCookie = res.getHeader('set-cookie');
  assert.match(setCookie, /Max-Age=7776000/);
  const token = decodeURIComponent(setCookie.match(/^caffeine_session=([^;]+)/)[1]);
  assert.deepEqual(verifySession(token, 'student', NOW + 7_775_999), {
    role: 'student', studentId: '1101', name: '테스트학생', exp: NOW + 7_776_000,
  });
  assert.throws(() => verifySession(token, 'student', NOW + 7_776_000), /expired session/i);
});

test('student API logout clears the session cookie', async () => {
  const res = response();
  await createLogoutHandler({ now: () => NOW })(request('POST'), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.getHeader('set-cookie'), /Max-Age=0/);
});

test('student API logout deactivates the current device with session identity', async () => {
  let forwarded;
  const handler = createLogoutHandler({
    now: () => NOW,
    callGas: async (input) => { forwarded = input; },
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ endpoint: 'https://push.example/device-a' }), studentCookie()), res);
  assert.equal(res.statusCode, 200);
  assert.equal(forwarded.action, 'deactivatePushSubscription');
  assert.deepEqual(forwarded.subject, { studentId: '1101', name: '테스트학생' });
  assert.match(forwarded.params[0], /^[a-f0-9]{64}$/);
  assert.match(res.getHeader('set-cookie'), /Max-Age=0/);
});

test('student API logout clears its cookie when deactivation fails', async () => {
  const handler = createLogoutHandler({
    now: () => NOW,
    callGas: async () => { throw new Error('private gateway failure'); },
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ endpoint: 'https://push.example/device-a' }), studentCookie()), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { success: true });
  assert.match(res.getHeader('set-cookie'), /Max-Age=0/);
  assert.doesNotMatch(res.body, /private gateway failure|push\.example/);
});

test('student API logout without a valid session never calls the gateway', async () => {
  let calls = 0;
  const handler = createLogoutHandler({
    now: () => NOW,
    callGas: async () => { calls += 1; },
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ endpoint: 'https://push.example/device-a' })), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 0);
  assert.match(res.getHeader('set-cookie'), /Max-Age=0/);
});
