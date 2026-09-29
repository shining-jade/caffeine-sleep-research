import assert from 'node:assert/strict';
import test from 'node:test';
import { call, event, loadAppsScript, outputJson } from './harness.js';

const secret = 'gateway-test-secret';

async function gateway(extra = {}) {
  return loadAppsScript({
    properties: { GAS_SHARED_SECRET: secret, SPREADSHEET_ID: 'current-sheet-id' },
    globals: {
      checkLogin(id, name) { return { success: true, studentId: id, name }; },
      getStats(id) { return { id }; },
      getCaffeineDB() { return { success: true, data: [] }; },
      getTeacherData() { return { success: true, students: [] }; },
      saveCaffeineData(payload) { return payload; },
      getReminderDispatchSnapshot_(type) { return { type }; },
      claimReminderDeliveries_(keys) { return keys; },
      recordReminderDeliveryResults_(results) { return { recorded: results.length }; },
      getReminderAdminConfig_() { return { enabled: false }; },
      getReminderStudentConfig_() { return { sleepTime: '08:00', caffeineTime: '20:00', globallyEnabled: false }; },
      getTestStudentReminderStatus_() { return { name: '테스트', sleepDevices: 1, caffeineDevices: 1 }; },
      getTestStudentReminderTargets_(type) { return { name: '테스트', type, subscriptions: [] }; },
      recordTestStudentReminderResults_(type, referenceDate, results) { return { type, referenceDate, recorded: results.length }; },
      ...extra,
    },
  });
}

test('spreadsheet provider opens only the private configured spreadsheet', async () => {
  const { context, openedIds } = await gateway();
  const result = call(context, 'getSpreadsheet_()');
  assert.equal(result.id, 'current-sheet-id');
  assert.deepEqual(openedIds, ['current-sheet-id']);
});

test('doGet exposes only a non-sensitive health response', async () => {
  const { context } = await gateway();
  const result = outputJson(call(context, 'doGet()'));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, service: 'caffeine-sleep-api' });
  assert.doesNotMatch(JSON.stringify(result), /secret|sheet/i);
});

test('gateway rejects missing body malformed JSON and wrong secrets generically', async () => {
  const { context } = await gateway();
  const missing = outputJson(call(context, 'doPost({})'));
  const malformed = outputJson(call(context, "doPost({postData:{contents:'{'}})"));
  context.badSecretEvent = event({ secret: 'wrong', role: 'public', action: 'checkLogin', params: [] });
  const wrong = outputJson(call(context, 'doPost(badSecretEvent)'));
  for (const result of [missing, malformed, wrong]) {
    assert.equal(result.success, false);
    assert.equal(result.error, 'REQUEST_REJECTED');
    assert.doesNotMatch(JSON.stringify(result), /wrong|gateway-test-secret|contents/i);
  }
});

test('public role permits only login', async () => {
  const { context } = await gateway();
  context.loginEvent = event({ secret, role: 'public', action: 'checkLogin', params: ['1101', '학생'] });
  context.deniedEvent = event({ secret, role: 'public', action: 'getTeacherData', params: [] });
  assert.equal(outputJson(call(context, 'doPost(loginEvent)')).data.studentId, '1101');
  assert.equal(outputJson(call(context, 'doPost(deniedEvent)')).error, 'REQUEST_REJECTED');
});

test('health role permits only the connection probe', async () => {
  const { context } = await gateway({ testConnection() { return { success: true, private: 'not returned by Vercel' }; } });
  context.healthEvent = event({ secret, role: 'health', action: 'testConnection', params: ['ignored'] });
  context.healthDenied = event({ secret, role: 'health', action: 'getTeacherData', params: [] });
  assert.equal(outputJson(call(context, 'doPost(healthEvent)')).data.success, true);
  assert.equal(outputJson(call(context, 'doPost(healthDenied)')).error, 'REQUEST_REJECTED');
});

test('student and teacher roles use distinct allowlists', async () => {
  const { context } = await gateway();
  context.studentEvent = event({
    secret, role: 'student', action: 'getStats', params: ['1101'],
    subject: { studentId: '1101', name: '학생' },
  });
  context.studentDenied = event({
    secret, role: 'student', action: 'getTeacherData', params: [],
    subject: { studentId: '1101', name: '학생' },
  });
  context.teacherEvent = event({ secret, role: 'teacher', action: 'getTeacherData', params: [] });
  context.teacherDenied = event({ secret, role: 'teacher', action: 'getStats', params: [] });
  assert.equal(outputJson(call(context, 'doPost(studentEvent)')).data.id, '1101');
  assert.equal(outputJson(call(context, 'doPost(studentDenied)')).error, 'REQUEST_REJECTED');
  assert.equal(outputJson(call(context, 'doPost(teacherEvent)')).data.success, true);
  assert.equal(outputJson(call(context, 'doPost(teacherDenied)')).error, 'REQUEST_REJECTED');
});

test('unknown roles actions and malformed params are rejected without echoing input', async () => {
  const { context } = await gateway();
  for (const body of [
    { secret, role: 'admin', action: 'getTeacherData', params: [] },
    { secret, role: 'teacher', action: 'notAFunction', params: ['sensitive-input'] },
    { secret, role: 'teacher', action: 'getTeacherData', params: {} },
  ]) {
    context.requestEvent = event(body);
    const result = outputJson(call(context, 'doPost(requestEvent)'));
    assert.equal(result.error, 'REQUEST_REJECTED');
    assert.doesNotMatch(JSON.stringify(result), /sensitive-input|notAFunction/);
  }
});

test('scheduler role permits only reminder dispatch actions', async () => {
  const { context } = await gateway();
  for (const [action, params] of [
    ['getReminderDispatchSnapshot', ['sleep', '2026-09-10T08:00:00+09:00']],
    ['claimReminderDeliveries', [['key'], 'execution', '2026-09-10T08:00:00Z']],
    ['recordReminderDeliveryResults', [[]]],
  ]) {
    context.schedulerEvent = event({ secret, role: 'scheduler', action, params });
    assert.equal(outputJson(call(context, 'doPost(schedulerEvent)')).success, true);
  }
  for (const action of ['getTeacherData', 'savePushSubscription', 'constructor']) {
    context.deniedSchedulerEvent = event({ secret, role: 'scheduler', action, params: [] });
    assert.equal(outputJson(call(context, 'doPost(deniedSchedulerEvent)')).error, 'REQUEST_REJECTED');
  }
});

test('student teacher and public roles cannot call another reminder role actions', async () => {
  const { context } = await gateway();
  const requests = [
    { role: 'public', action: 'getReminderAdminConfig', params: [] },
    { role: 'student', action: 'getReminderAdminConfig', params: [], subject: { studentId: '1101', name: '학생' } },
    { role: 'teacher', action: 'getReminderDispatchSnapshot', params: [] },
  ];
  for (const request of requests) {
    context.crossRoleEvent = event({ secret, ...request });
    assert.equal(outputJson(call(context, 'doPost(crossRoleEvent)')).error, 'REQUEST_REJECTED');
  }
});

test('student role can read only the limited reminder config action', async () => {
  const { context } = await gateway();
  context.studentReminderConfig = event({
    secret,
    role: 'student',
    action: 'getReminderStudentConfig',
    params: [],
    subject: { studentId: '1101', name: '학생' },
  });
  const result = outputJson(call(context, 'doPost(studentReminderConfig)'));
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    sleepTime: '08:00', caffeineTime: '20:00', globallyEnabled: false,
  });
});

test('test student reminder actions are teacher-only', async () => {
  const { context } = await gateway();
  const allowed = [
    ['getTestStudentReminderStatus', []],
    ['getTestStudentReminderTargets', ['sleep']],
    ['recordTestStudentReminderResults', ['sleep', '2026-09-28', []]],
  ];
  for (const [action, params] of allowed) {
    context.teacherTestStudentEvent = event({ secret, role: 'teacher', action, params });
    assert.equal(outputJson(call(context, 'doPost(teacherTestStudentEvent)')).success, true);
    for (const request of [
      { role: 'student', subject: { studentId: '1101', name: '테스트' } },
      { role: 'scheduler' },
      { role: 'public' },
    ]) {
      context.deniedTestStudentEvent = event({ secret, action, params, ...request });
      assert.equal(outputJson(call(context, 'doPost(deniedTestStudentEvent)')).error, 'REQUEST_REJECTED');
    }
  }
});
