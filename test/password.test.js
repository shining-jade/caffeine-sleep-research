import test from 'node:test';
import assert from 'node:assert/strict';
import { scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

import { verifyTeacherPassword } from '../api/_lib/password.js';

const scrypt = promisify(scryptCallback);
const CANDIDATE = 'test-only-teacher-password';
const SALT = 'ab'.repeat(16);

async function hash(password) {
  return Buffer.from(await scrypt(password, Buffer.from(SALT, 'hex'), 64)).toString('hex');
}

test('teacher password accepts the correct candidate', async () => {
  assert.equal(await verifyTeacherPassword(CANDIDATE, SALT, await hash(CANDIDATE)), true);
});

test('teacher password rejects an incorrect candidate', async () => {
  assert.equal(await verifyTeacherPassword('wrong-password', SALT, await hash(CANDIDATE)), false);
});

test('teacher password rejects malformed salt and hash without throwing', async () => {
  assert.equal(await verifyTeacherPassword(CANDIDATE, 'not-hex', 'also-not-hex'), false);
  assert.equal(await verifyTeacherPassword(CANDIDATE, SALT, '00'), false);
  assert.equal(await verifyTeacherPassword(null, SALT, await hash(CANDIDATE)), false);
});

test('teacher password compares equal-length derived buffers', async () => {
  const expected = await hash(CANDIDATE);
  const changed = `${expected.slice(0, -2)}${expected.endsWith('00') ? '01' : '00'}`;
  assert.equal(changed.length, expected.length);
  assert.equal(await verifyTeacherPassword(CANDIDATE, SALT, changed), false);
});

test('teacher password failures never reveal the candidate', async () => {
  try {
    const result = await verifyTeacherPassword(CANDIDATE, 'bad', 'bad');
    assert.equal(result, false);
  } catch (error) {
    assert.equal(`${error.message} ${error.stack}`.includes(CANDIDATE), false);
  }
});
