import test from 'node:test';
import assert from 'node:assert/strict';

import { STUDENT_ACTIONS } from '../api/_lib/actions.js';
import { normalizeStudentRequest } from '../api/_lib/student-policy.js';

const SESSION = { role: 'student', studentId: '1101', name: '테스트학생', exp: 9_999_999_999 };

const EXPECTED_ACTIONS = [
  'saveCaffeineData', 'getCaffeineLogs', 'deleteCaffeineData', 'updateCaffeineData',
  'saveSleepData', 'getSleepLogs', 'deleteSleepData', 'updateSleepData',
  'getWeightData', 'saveInitialSetup', 'getStats', 'getFilteredStats',
  'getTeacherAwardsForStudent', 'markTeacherAwardsSeen', 'submitInquiry',
  'getMyInquiries', 'getCaffeineDB', 'testConnection', 'generateAIHealthReport',
  'analyzeDrinkImageWithAI', 'getTeacherMessages', 'markTeacherMessageRead',
  'replyToTeacherMessage', 'getBadgeConfig', 'getChallengeBadgeConfig',
  'getSleepSettings',
];

test('student policy contains every student UI action and no login action', () => {
  assert.deepEqual([...STUDENT_ACTIONS].sort(), EXPECTED_ACTIONS.sort());
  assert.equal(STUDENT_ACTIONS.has('checkLogin'), false);
});

test('student policy rejects unknown and teacher-only actions', () => {
  assert.throws(() => normalizeStudentRequest('getTeacherData', [], SESSION), /not allowed/i);
  assert.throws(() => normalizeStudentRequest('constructor', [], SESSION), /not allowed/i);
});

test('student identity replaces the first argument for own-data reads', () => {
  const result = normalizeStudentRequest(
    'getCaffeineLogs',
    ['9999', '2026-09-01', '2026-09-07'],
    SESSION,
  );

  assert.deepEqual(result.params, ['1101', '2026-09-01', '2026-09-07']);
  assert.deepEqual(result.subject, { studentId: '1101', name: '테스트학생' });
});

test('student identity replaces both identity arguments for named actions', () => {
  const report = normalizeStudentRequest(
    'generateAIHealthReport',
    ['9999', '다른학생', 10, 2, 8, 50, 125],
    SESSION,
  );
  const awards = normalizeStudentRequest(
    'markTeacherAwardsSeen',
    ['9999', '다른학생', [{ awardId: 'badge' }]],
    SESSION,
  );

  assert.deepEqual(report.params.slice(0, 2), ['1101', '테스트학생']);
  assert.deepEqual(awards.params, ['1101', '테스트학생', [{ awardId: 'badge' }]]);
});

test('student identity overwrites payload saves without mutating input', () => {
  const payload = { studentId: '9999', name: '다른학생', mg: 100 };

  const result = normalizeStudentRequest('saveCaffeineData', [payload], SESSION);

  assert.deepEqual(result.params, [{ studentId: '1101', name: '테스트학생', mg: 100 }]);
  assert.deepEqual(payload, { studentId: '9999', name: '다른학생', mg: 100 });
});

test('student ownership metadata is attached to record and row operations', () => {
  for (const [action, params] of [
    ['deleteCaffeineData', ['record-id']],
    ['deleteSleepData', ['sleep-id']],
    ['markTeacherMessageRead', [7]],
    ['replyToTeacherMessage', [7, 'reply']],
  ]) {
    const result = normalizeStudentRequest(action, params, SESSION);
    assert.deepEqual(result.subject, { studentId: '1101', name: '테스트학생' });
    assert.deepEqual(result.params, params);
  }
});

test('student policy requires an array of parameters', () => {
  assert.throws(() => normalizeStudentRequest('getStats', { studentId: '9999' }, SESSION), /parameters/i);
});
