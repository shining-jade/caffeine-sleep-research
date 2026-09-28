import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLoginRateLimit } from '../api/_lib/rate-limit.js';

function request(ip) { return { headers: { 'x-forwarded-for': ip }, socket: {} }; }

test('real limiter isolates client IPs and resets after its fixed window', () => {
  const scope = `test-${Math.random()}`;
  const options = { max: 2, windowMs: 1000, now: 1000 };
  assert.equal(checkLoginRateLimit(request('192.0.2.1'), scope, options).allowed, true);
  assert.equal(checkLoginRateLimit(request('192.0.2.1'), scope, options).allowed, true);
  assert.equal(checkLoginRateLimit(request('192.0.2.1'), scope, options).allowed, false);
  assert.equal(checkLoginRateLimit(request('192.0.2.2'), scope, options).allowed, true);
  assert.equal(checkLoginRateLimit(request('192.0.2.1'), scope, { ...options, now: 2001 }).allowed, true);
});
