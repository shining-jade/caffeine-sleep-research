import assert from 'node:assert/strict';
import test from 'node:test';
import { createHealthHandler } from '../api/health.js';

function response() {
  return { statusCode: 0, body: '', setHeader() {}, end(value = '') { this.body = value; }, json() { return JSON.parse(this.body); } };
}

test('health endpoint verifies the private data gateway without leaking its response', async () => {
  let forwarded;
  const handler = createHealthHandler({ callGas: async (input) => { forwarded = input; return { private: 'hidden' }; } });
  const res = response();
  await handler({ method: 'GET' }, res);
  assert.deepEqual(forwarded, { role: 'health', action: 'testConnection', params: [], subject: null });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, service: 'caffeine-sleep' });
  assert.equal(res.body.includes('private'), false);
});

test('health endpoint rejects methods and maps upstream failure generically', async () => {
  const handler = createHealthHandler({ callGas: async () => { throw new Error('secret detail'); } });
  const method = response();
  await handler({ method: 'POST' }, method);
  assert.equal(method.statusCode, 405);
  const failed = response();
  await handler({ method: 'GET' }, failed);
  assert.equal(failed.statusCode, 503);
  assert.deepEqual(failed.json(), { ok: false, error: 'SERVICE_UNAVAILABLE' });
});
