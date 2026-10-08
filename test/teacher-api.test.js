import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { createActionHandler } from '../api/teacher/action.js';
import { createLoginHandler } from '../api/teacher/login.js';
import { createLogoutHandler } from '../api/teacher/logout.js';
import { createSessionHandler } from '../api/teacher/session.js';
import { normalizeTeacherRequest, TEACHER_ACTIONS } from '../api/_lib/teacher-policy.js';
import { createSession } from '../api/_lib/session.js';

process.env.SESSION_SECRET = 'teacher-api-test-session-secret';
process.env.GAS_API_URL = 'https://example.invalid/gas';
process.env.GAS_SHARED_SECRET = 'gateway-secret';
process.env.TEACHER_PASSWORD_SALT = '00'.repeat(16);
process.env.TEACHER_PASSWORD_HASH = '11'.repeat(64);

const NOW = 1_800_000_000;
const EXPECTED_ACTIONS = [
  'updateTeacherHiddenStudents', 'getTeacherData', 'handleAIReportForTeacher', 'grantTeacherAwards',
  'revokeTeacherAward', 'getInquiries', 'replyToInquiry', 'deleteInquiry',
  'getUnreadInquiries', 'markInquiryNotified', 'exportDataToNewSheet',
  'sendTeacherMessage', 'saveTeacherPdfAndSendMessage', 'getSentTeacherMessages',
  'deleteTeacherMessage', 'deleteBulkTeacherMessages', 'getUnreadStudentReplies',
  'markStudentReplyRead', 'saveBadgeConfig', 'getChallengeBadgeConfig',
  'saveChallengeBadgeConfig', 'getPendingBadges', 'savePendingBadgesData',
  'getDismissedBadges', 'saveDismissedBadgesData', 'getAwardSettings',
  'saveAwardSettingsData', 'saveAIReport', 'getAIReport', 'saveSleepSettings',
  'getReminderAdminConfig', 'saveReminderAdminConfig', 'saveTeacherTestSubscription',
  'deactivateTeacherTestSubscription', 'getTestStudentReminderStatus',
  'getTestStudentReminderTargets', 'recordTestStudentReminderResults',
];

function request(method, body, cookie = '') {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
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

function roleCookie(role = 'teacher', exp = NOW + 3600) {
  const payload = role === 'teacher'
    ? { role, exp }
    : { role, studentId: '1101', name: '테스트학생', exp };
  const token = createSession(payload, Math.min(NOW, exp - 1));
  return `caffeine_session=${encodeURIComponent(token)}`;
}

test('teacher API policy contains only current teacher UI actions', () => {
  assert.deepEqual([...TEACHER_ACTIONS].sort(), EXPECTED_ACTIONS.sort());
  assert.equal(TEACHER_ACTIONS.has('saveCaffeineData'), false);
});

test('teacher API rejects missing and wrong password generically', async () => {
  const verifyPassword = async (candidate) => candidate === 'correct-password';
  const handler = createLoginHandler({ verifyPassword, now: () => NOW });

  for (const body of [{}, { password: 'wrong-password' }]) {
    const res = response();
    await handler(request('POST', JSON.stringify(body)), res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { success: false, error: 'INVALID_CREDENTIALS' });
    assert.equal(res.body.includes('wrong-password'), false);
  }
});

test('teacher login is rate limited before password verification', async () => {
  let verified = 0;
  const handler = createLoginHandler({
    verifyPassword: async () => { verified += 1; return false; },
    checkRateLimit: () => ({ allowed: false, retryAfter: 60 }),
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ password: 'guess' })), res);
  assert.equal(res.statusCode, 429);
  assert.equal(verified, 0);
});

test('teacher API issues cookie after correct password without forwarding it', async () => {
  let seenCandidate;
  const handler = createLoginHandler({
    verifyPassword: async (candidate) => { seenCandidate = candidate; return true; },
    now: () => NOW,
  });
  const res = response();
  await handler(request('POST', JSON.stringify({ password: 'correct-password' })), res);

  assert.equal(seenCandidate, 'correct-password');
  assert.equal(res.statusCode, 200);
  assert.match(res.getHeader('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.match(res.getHeader('set-cookie'), /Max-Age=2592000/);
  assert.deepEqual(res.json(), { success: true, authenticated: true, role: 'teacher' });
});

test('teacher API rejects unsupported methods and malformed or oversized JSON', async () => {
  const login = createLoginHandler({ verifyPassword: async () => false, now: () => NOW });
  const method = response();
  await login(request('GET'), method);
  assert.equal(method.statusCode, 405);

  const malformed = response();
  await login(request('POST', '{bad'), malformed);
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error, 'INVALID_JSON');

  const oversized = response();
  await login(request('POST', JSON.stringify({ value: 'x'.repeat(256 * 1024) })), oversized);
  assert.equal(oversized.statusCode, 413);
});

test('teacher API denies missing wrong-role tampered and expired sessions', async () => {
  let calls = 0;
  const handler = createActionHandler({ callGas: async () => { calls += 1; }, now: () => NOW });
  const valid = roleCookie();
  const cookies = ['', roleCookie('student'), `${valid}x`, roleCookie('teacher', NOW - 1)];

  for (const cookie of cookies) {
    const res = response();
    await handler(request('POST', JSON.stringify({ action: 'getTeacherData', params: [] }), cookie), res);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(calls, 0);
});

test('teacher API denies unknown and student-only actions', async () => {
  let calls = 0;
  const handler = createActionHandler({ callGas: async () => { calls += 1; }, now: () => NOW });
  for (const action of ['unknownAction', 'saveCaffeineData']) {
    const res = response();
    await handler(request('POST', JSON.stringify({ action, params: [] }), roleCookie()), res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(calls, 0);
});

test('teacher API forwards allowed action without password or session data', async () => {
  let forwarded;
  const handler = createActionHandler({
    callGas: async (input) => { forwarded = input; return [{ id: 'redacted' }]; },
    now: () => NOW,
  });
  const res = response();
  await handler(request('POST', JSON.stringify({
    action: 'getTeacherData', params: ['2026-09-01', '2026-09-07'], password: 'do-not-forward',
  }), roleCookie()), res);

  assert.deepEqual(forwarded, {
    role: 'teacher',
    action: 'getTeacherData',
    params: ['2026-09-01', '2026-09-07'],
    subject: null,
  });
  assert.equal(JSON.stringify(forwarded).includes('password'), false);
  assert.equal(res.statusCode, 200);
});

test('teacher API session inspection and logout are role-safe', async () => {
  const sessionRes = response();
  await createSessionHandler({ now: () => NOW })(request('GET', undefined, roleCookie()), sessionRes);
  assert.deepEqual(sessionRes.json(), { authenticated: true, role: 'teacher' });

  const logoutRes = response();
  await createLogoutHandler()(request('POST'), logoutRes);
  assert.match(logoutRes.getHeader('set-cookie'), /Max-Age=0/);
});

test('teacher API accepts chart-sized PDF bodies only for authenticated PDF sends', async () => {
  const calls = [];
  const handler = createActionHandler({ callGas: async (input) => { calls.push(input); return { success: true }; }, now: () => NOW });
  const html = `<html><img src="data:image/png;base64,${'x'.repeat(512 * 1024)}"></html>`;
  const body = JSON.stringify({ action: 'saveTeacherPdfAndSendMessage', params: [{ studentId: '0', html }] });
  const denied = response();
  await handler(request('POST', body), denied);
  assert.equal(denied.statusCode, 401);
  assert.equal(calls.length, 0);
  const accepted = response();
  await handler(request('POST', body, roleCookie()), accepted);
  assert.equal(accepted.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0].html, html);
});

test('teacher API keeps ordinary actions at 256 KiB and bounds PDF sends at 4 MiB', async () => {
  let calls = 0;
  const handler = createActionHandler({ callGas: async () => { calls += 1; }, now: () => NOW });
  for (const [action, value] of [
    ['sendTeacherMessage', '한'.repeat(90 * 1024)],
    ['saveTeacherPdfAndSendMessage', 'x'.repeat(4 * 1024 * 1024)],
  ]) {
    const res = response();
    await handler(request('POST', JSON.stringify({ action, params: [{ html: value }] }), roleCookie()), res);
    assert.equal(res.statusCode, 413);
    assert.equal(res.json().error, 'PAYLOAD_TOO_LARGE');
  }
  assert.equal(calls, 0);
});

test('teacher reminder actions are allowlisted without admitting scheduler actions', () => {
  assert.deepEqual(normalizeTeacherRequest('getReminderAdminConfig', []).params, []);
  assert.deepEqual(normalizeTeacherRequest('saveReminderAdminConfig', [{ enabled: false }]).params, [{ enabled: false }]);
  assert.deepEqual(normalizeTeacherRequest('getTestStudentReminderStatus', []).params, []);
  assert.deepEqual(normalizeTeacherRequest('getTestStudentReminderTargets', ['sleep']).params, ['sleep']);
  assert.deepEqual(normalizeTeacherRequest('recordTestStudentReminderResults', ['sleep', '2026-09-28', []]).params, ['sleep', '2026-09-28', []]);
  assert.throws(() => normalizeTeacherRequest('getReminderDispatchSnapshot', []), /not allowed/i);
  assert.throws(() => normalizeTeacherRequest('recordReminderDeliveryResults', []), /not allowed/i);
});
