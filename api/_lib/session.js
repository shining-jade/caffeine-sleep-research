import { createHmac, timingSafeEqual } from 'node:crypto';

import { requireEnv } from './env.js';

const COOKIE_NAME = 'caffeine_session';
const MAX_COOKIE_AGE = 90 * 24 * 60 * 60;
export const STUDENT_SESSION_SECONDS = MAX_COOKIE_AGE;

function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(encodedPayload) {
  return createHmac('sha256', requireEnv('SESSION_SECRET'))
    .update(encodedPayload)
    .digest('base64url');
}

function assertPayload(payload, now) {
  const validRole = payload?.role === 'student' || payload?.role === 'teacher';
  const validExpiry = Number.isInteger(payload?.exp) && payload.exp > now;
  const validStudent = payload?.role !== 'student'
    || (typeof payload.studentId === 'string' && payload.studentId.length > 0
      && typeof payload.name === 'string' && payload.name.length > 0);

  if (!validRole || !validExpiry || !validStudent) {
    throw new Error('Invalid session.');
  }
}

export function createSession(payload, now = Math.floor(Date.now() / 1000)) {
  assertPayload(payload, now);
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySession(token, expectedRole, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') throw new Error('Invalid session.');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Invalid session.');

  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = sign(encodedPayload);
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error('Invalid session.');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid session.');
  }

  if (!Number.isInteger(payload?.exp) || payload.exp <= now) {
    throw new Error('Expired session.');
  }
  assertPayload(payload, now);
  if (payload.role !== expectedRole) throw new Error('Invalid session.');
  return payload;
}

function cookieName(role) {
  if (role === 'student') return 'caffeine_student_session';
  if (role === 'teacher') return 'caffeine_teacher_session';
  return COOKIE_NAME;
}

function cookieValue(req, name) {
  const header = req?.headers?.cookie;
  if (typeof header !== 'string' || header.length === 0) return null;
  const matches = header.split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  try {
    const value = decodeURIComponent(matches[0].slice(name.length + 1));
    return value || null;
  } catch {
    return null;
  }
}

function legacyBelongsToRole(req, role) {
  const legacy = cookieValue(req, COOKIE_NAME);
  if (!legacy) return false;
  try { verifySession(legacy, role, 0); return true; } catch { return false; }
}

export function readSessionCookie(req, role) {
  const name = cookieName(role);
  if (name === COOKIE_NAME) return cookieValue(req, name);
  // A malformed role cookie must never fall back to an older login.
  const parts = typeof req?.headers?.cookie === 'string' ? req.headers.cookie.split(';') : [];
  if (parts.some(part => part.trim().startsWith(`${name}=`))) return cookieValue(req, name);
  return legacyBelongsToRole(req, role) ? cookieValue(req, COOKIE_NAME) : null;
}

export function setSessionCookie(res, token, maxAge, role) {
  const boundedAge = Math.max(1, Math.min(MAX_COOKIE_AGE, Math.floor(maxAge)));
  res.setHeader(
    'Set-Cookie',
    `${cookieName(role)}=${encodeURIComponent(token)}; Path=/; Max-Age=${boundedAge}; HttpOnly; Secure; SameSite=Lax`,
  );
}

export function clearSessionCookie(res, role, req) {
  const cookies = [`${cookieName(role)}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`];
  if (role && legacyBelongsToRole(req, role)) {
    cookies.push(`${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  }
  res.setHeader(
    'Set-Cookie',
    cookies.length === 1 ? cookies[0] : cookies,
  );
}
