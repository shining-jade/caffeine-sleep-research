import test from 'node:test';
import assert from 'node:assert/strict';

import { callGas } from '../api/_lib/gas.js';

process.env.GAS_API_URL = 'https://script.google.com/macros/s/private-deployment/exec';
process.env.GAS_SHARED_SECRET = 'private-gateway-secret';
process.env.SESSION_SECRET = 'test-session-secret-with-sufficient-length';
process.env.TEACHER_PASSWORD_SALT = '00'.repeat(16);
process.env.TEACHER_PASSWORD_HASH = '11'.repeat(64);

const request = {
  role: 'student',
  action: 'getStats',
  params: ['1101'],
  subject: { studentId: '1101', name: '테스트학생' },
};

test('callGas sends POST text plain body', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ success: true, data: { ok: true } }), { status: 200 });
  };

  await callGas({ ...request, fetchImpl });

  assert.equal(captured.url, process.env.GAS_API_URL);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(JSON.parse(captured.options.body), {
    secret: process.env.GAS_SHARED_SECRET,
    role: request.role,
    action: request.action,
    params: request.params,
    subject: request.subject,
  });
});

test('callGas follows a successful Apps Script response', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ success: true, data: { count: 3 } }),
    { status: 200 },
  );

  assert.deepEqual(await callGas({ ...request, fetchImpl }), { count: 3 });
});

test('script execution redirects retain POST, output redirects use GET without secret', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(null, { status: 302, headers: { Location: 'https://script.google.com/a/domain/macros/s/private-deployment/exec' } });
    if (calls.length === 2) return new Response(null, { status: 302, headers: { Location: 'https://script.googleusercontent.com/macros/echo?key=output' } });
    return new Response(JSON.stringify({ success: true, data: { success: true, data: [{ f: '커피' }] } }));
  };
  const result = await callGas({ ...request, action: 'getCaffeineDB', fetchImpl });
  assert.equal(result.data.length, 1);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, calls[0].options.body);
  assert.equal(calls[2].options.method, 'GET');
  assert.equal(calls[2].options.body, undefined);
});

test('callGas rejects upstream success false', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ success: false, error: 'private sheet detail' }),
    { status: 200 },
  );

  await assert.rejects(
    callGas({ ...request, fetchImpl }),
    (error) => error.code === 'GAS_REJECTED'
      && error.status === 502
      && !error.message.includes('private sheet detail'),
  );
});

test('redirects cannot send the gateway secret to another host', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: 'https://example.com/collect' } });
  };
  await assert.rejects(callGas({ ...request, fetchImpl }), error => error.code === 'GAS_UNAVAILABLE');
  assert.equal(calls, 1);
});

test('callGas rejects an HTML redirect page', async () => {
  const fetchImpl = async () => new Response('<html>Google login</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });

  await assert.rejects(
    callGas({ ...request, fetchImpl }),
    (error) => error.code === 'GAS_UNAVAILABLE' && error.status === 502,
  );
});

test('callGas times out', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  await assert.rejects(
    callGas({ ...request, fetchImpl, timeoutMs: 5 }),
    (error) => error.code === 'GAS_TIMEOUT' && error.status === 504,
  );
});

test('callGas never exposes URL secret or upstream body in its public error', async () => {
  const privateBody = 'student-health-value';
  const fetchImpl = async () => new Response(privateBody, { status: 500 });

  await assert.rejects(
    callGas({ ...request, fetchImpl }),
    (error) => {
      const rendered = `${error.message} ${error.stack}`;
      return error.code === 'GAS_UNAVAILABLE'
        && !rendered.includes(process.env.GAS_API_URL)
        && !rendered.includes(process.env.GAS_SHARED_SECRET)
        && !rendered.includes(privateBody);
    },
  );
});
