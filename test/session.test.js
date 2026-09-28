import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearSessionCookie,
  createSession,
  readSessionCookie,
  setSessionCookie,
  verifySession,
} from '../api/_lib/session.js';

process.env.SESSION_SECRET = 'test-session-secret-with-sufficient-length';

const NOW = 1_800_000_000;

test('student session round trips', () => {
  const payload = {
    role: 'student',
    studentId: '1101',
    name: '테스트학생',
    exp: NOW + 3600,
  };

  const token = createSession(payload, NOW);

  assert.deepEqual(verifySession(token, 'student', NOW), payload);
});

test('teacher session round trips', () => {
  const payload = { role: 'teacher', exp: NOW + 1800 };

  const token = createSession(payload, NOW);

  assert.deepEqual(verifySession(token, 'teacher', NOW), payload);
});

test('tampered session is rejected', () => {
  const token = createSession({ role: 'teacher', exp: NOW + 1800 }, NOW);
  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

  assert.throws(() => verifySession(tampered, 'teacher', NOW), /invalid session/i);
});

test('expired session is rejected', () => {
  const token = createSession({ role: 'teacher', exp: NOW + 10 }, NOW);

  assert.throws(() => verifySession(token, 'teacher', NOW + 11), /expired session/i);
});

test('wrong role is rejected', () => {
  const token = createSession({ role: 'teacher', exp: NOW + 1800 }, NOW);

  assert.throws(() => verifySession(token, 'student', NOW), /invalid session/i);
});

test('duplicate or malformed cookie is rejected', () => {
  assert.equal(readSessionCookie({ headers: { cookie: 'caffeine_session=one; caffeine_session=two' } }), null);
  assert.equal(readSessionCookie({ headers: { cookie: 'caffeine_session=%E0%A4%A' } }), null);
  assert.equal(readSessionCookie({ headers: {} }), null);
});

test('session cookie uses secure bounded attributes', () => {
  const headers = new Map();
  const res = { setHeader: (name, value) => headers.set(name.toLowerCase(), value) };

  setSessionCookie(res, 'signed-token', 999_999);
  const cookie = headers.get('set-cookie');

  assert.match(cookie, /^caffeine_session=signed-token;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=28800/);

  clearSessionCookie(res);
  assert.match(headers.get('set-cookie'), /Max-Age=0/);
});
