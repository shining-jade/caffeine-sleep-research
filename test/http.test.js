import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { readJson, sendJson } from '../api/_lib/http.js';

function requestFrom(text) {
  const req = Readable.from([Buffer.from(text)]);
  req.headers = {};
  return req;
}

test('readJson rejects malformed JSON', async () => {
  const submitted = '{"student":"private-value"';

  await assert.rejects(
    readJson(requestFrom(submitted)),
    (error) => error.code === 'INVALID_JSON'
      && error.status === 400
      && !error.message.includes('private-value'),
  );
});

test('readJson rejects bodies above 256 KiB', async () => {
  const submitted = JSON.stringify({ value: 'x'.repeat(256 * 1024) });

  await assert.rejects(
    readJson(requestFrom(submitted)),
    (error) => error.code === 'PAYLOAD_TOO_LARGE'
      && error.status === 413
      && !error.message.includes('xxxxx'),
  );
});

test('sendJson sets no-store JSON headers', () => {
  const headers = new Map();
  let ended = '';
  const res = {
    statusCode: 0,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    end(value) {
      ended = value;
    },
  };

  sendJson(res, 201, { ok: true });

  assert.equal(res.statusCode, 201);
  assert.equal(headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(ended), { ok: true });
});
