import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { GAS_TIMEOUT_MS, GasGatewayError } from '../api/_lib/gas.js';
import { createActionHandler as studentAction } from '../api/student/action.js';
import { createLoginHandler as studentLogin } from '../api/student/login.js';
import { createLogoutHandler as studentLogout } from '../api/student/logout.js';
import { createActionHandler as teacherAction } from '../api/teacher/action.js';
import { createLoginHandler as teacherLogin } from '../api/teacher/login.js';

process.env.SESSION_SECRET = 'integration-session-secret';
process.env.GAS_API_URL = 'https://example.invalid/apps-script';
process.env.GAS_SHARED_SECRET = 'integration-gateway-secret';
process.env.TEACHER_PASSWORD_SALT = '00'.repeat(16);
process.env.TEACHER_PASSWORD_HASH = '11'.repeat(64);

const NOW = 1_800_100_000;

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

function cookieFrom(res) {
  return String(res.getHeader('set-cookie')).split(';', 1)[0];
}

function mockGateway() {
  const students = new Map([
    ['1101|학생가', { studentId: '1101', name: '학생가' }],
    ['1102|학생나', { studentId: '1102', name: '학생나' }],
  ]);
  const records = [];
  return async function callGas(input) {
    if (input.role === 'public' && input.action === 'checkLogin') {
      const found = students.get(`${input.params[0]}|${input.params[1]}`);
      return found ? { success: true, ...found } : { success: false };
    }
    if (input.role === 'student' && input.action === 'saveCaffeineData') {
      const record = { ...input.params[0], owner: input.subject.studentId };
      records.push(record);
      return { success: true };
    }
    if (input.role === 'student' && input.action === 'getCaffeineLogs') {
      return records.filter((record) => record.owner === input.subject.studentId);
    }
    if (input.role === 'student' && input.action === 'deleteCaffeineData') {
      const record = records.find((item) => item.id === input.params[0]);
      if (!record || record.owner !== input.subject.studentId) {
        throw new GasGatewayError(502, 'GAS_REJECTED', 'rejected');
      }
      return { success: true };
    }
    if (input.role === 'teacher' && input.action === 'getTeacherData') {
      return { success: true, caffeine: [...records] };
    }
    if (input.action === 'getStats') throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'private detail');
    throw new GasGatewayError(502, 'GAS_REJECTED', 'rejected');
  };
}

async function loginStudent(handler, studentId, name) {
  const res = response();
  await handler(request('POST', JSON.stringify({ studentId, name })), res);
  assert.equal(res.statusCode, 200);
  return cookieFrom(res);
}

test('integration: student own save/read, cross-student denial, teacher read, logout and safe failures', async () => {
  const callGas = mockGateway();
  const login = studentLogin({ callGas, now: () => NOW });
  const student = studentAction({ callGas, now: () => NOW });
  const teacherSignIn = teacherLogin({ verifyPassword: async (candidate) => candidate === 'test-only', now: () => NOW });
  const teacher = teacherAction({ callGas, now: () => NOW });

  const [cookieA, cookieB] = await Promise.all([
    loginStudent(login, '1101', '학생가'),
    loginStudent(login, '1102', '학생나'),
  ]);
  const teacherLoginRes = response();
  await teacherSignIn(request('POST', JSON.stringify({ password: 'test-only' })), teacherLoginRes);
  const teacherCookie = cookieFrom(teacherLoginRes);

  const saveRes = response();
  await student(request('POST', JSON.stringify({
    action: 'saveCaffeineData',
    params: [{ id: 'record-a', studentId: '1102', name: '학생나', mg: 10 }],
  }), cookieA), saveRes);
  assert.equal(saveRes.statusCode, 200);

  const readA = response();
  const readB = response();
  await Promise.all([
    student(request('POST', JSON.stringify({ action: 'getCaffeineLogs', params: ['1102'] }), cookieA), readA),
    student(request('POST', JSON.stringify({ action: 'getCaffeineLogs', params: ['1101'] }), cookieB), readB),
  ]);
  assert.equal(readA.json().data[0].studentId, '1101');
  assert.equal(readB.json().data.length, 0);

  const crossDelete = response();
  await student(request('POST', JSON.stringify({ action: 'deleteCaffeineData', params: ['record-a'] }), cookieB), crossDelete);
  assert.equal(crossDelete.statusCode, 502);
  assert.deepEqual(crossDelete.json(), { success: false, error: 'GAS_REJECTED' });

  const teacherRead = response();
  await teacher(request('POST', JSON.stringify({ action: 'getTeacherData', params: [] }), teacherCookie), teacherRead);
  assert.equal(teacherRead.json().data.caffeine.length, 1);

  const logoutRes = response();
  await studentLogout()(request('POST'), logoutRes);
  assert.match(logoutRes.getHeader('set-cookie'), /Max-Age=0/);
  const afterLogout = response();
  await student(request('POST', JSON.stringify({ action: 'getCaffeineLogs', params: [] })), afterLogout);
  assert.equal(afterLogout.statusCode, 401);

  const upstreamFailure = response();
  await student(request('POST', JSON.stringify({ action: 'getStats', params: [] }), cookieA), upstreamFailure);
  assert.deepEqual(upstreamFailure.json(), { success: false, error: 'GAS_UNAVAILABLE' });
  assert.doesNotMatch(upstreamFailure.body, /private detail/);
});

test('integration: Vercel config applies clean URLs, function duration and security headers', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.cleanUrls, true);
  assert.equal(config.functions['api/**/*.js'].maxDuration, 60);
  assert.equal(GAS_TIMEOUT_MS, 50_000);
  assert.ok(GAS_TIMEOUT_MS <= (config.functions['api/**/*.js'].maxDuration * 1000) - 5_000);
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
});
