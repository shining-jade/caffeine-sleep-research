import assert from 'node:assert/strict';
import test from 'node:test';

import { call, createMemorySpreadsheet, loadAppsScript } from './harness.js';

const CONFIG_HEADERS = [
  '설정버전', '전체활성화', '수면활성화', '카페인활성화', '수면알림시각', '카페인알림시각', '주말포함',
  '1반시작일', '1반종료일', '2반시작일', '2반종료일', '3반시작일', '3반종료일', '4반시작일', '4반종료일',
  '수정시각', '수정주체',
];

const SUBSCRIPTION_HEADERS = [
  '구독ID', '역할', '학생학번', 'endpoint', 'p256dh', 'auth', '수면알림허용', '카페인알림허용',
  '활성상태', '생성시각', '마지막갱신시각', '마지막성공시각', '마지막오류코드',
];

const DELIVERY_HEADERS = [
  '중복방지키', '기준날짜', '알림유형', '학번', '구독ID', '발송시각', '결과', '오류코드',
];

async function reminders(initialSheets = {}, extra = {}) {
  const spreadsheet = createMemorySpreadsheet(initialSheets);
  const lockEvents = [];
  const loaded = await loadAppsScript({
    files: ['Spreadsheet.gs', 'Ownership.gs', 'Reminders.gs'],
    properties: { SPREADSHEET_ID: 'current-sheet-id', ...(extra.properties || {}) },
    globals: { __spreadsheet: spreadsheet, __lockEvents: lockEvents, ...(extra.globals || {}) },
  });
  return { ...loaded, spreadsheet, lockEvents };
}

function rows(spreadsheet, name) {
  return spreadsheet.getSheetByName(name).getDataRange().getValues();
}

test('reminder sheets are created with exact private headers and existing research rows stay unchanged', async () => {
  const caffeine = [['타임스탬프', '전체학번', '음료명'], ['existing', '1101', '커피']];
  const { context, spreadsheet, openedIds } = await reminders({ caffeine });

  call(context, 'ensureReminderSheets_()');

  assert.deepEqual(rows(spreadsheet, '알림설정')[0], CONFIG_HEADERS);
  assert.deepEqual(rows(spreadsheet, '푸시구독')[0], SUBSCRIPTION_HEADERS);
  assert.deepEqual(rows(spreadsheet, '알림발송로그')[0], DELIVERY_HEADERS);
  assert.deepEqual(rows(spreadsheet, 'caffeine'), caffeine);
  assert.deepEqual(openedIds, ['current-sheet-id']);
});

test('reminder sheet creation is idempotent', async () => {
  const { context, spreadsheet } = await reminders();
  call(context, 'ensureReminderSheets_()');
  call(context, 'ensureReminderSheets_()');

  assert.deepEqual(spreadsheet.getSheets().map((sheet) => sheet.getName()), [
    '알림설정', '푸시구독', '알림발송로그',
  ]);
  assert.equal(rows(spreadsheet, '알림설정').length, 1);
});

test('new reminder config is disabled and uses approved default hours', async () => {
  const { context } = await reminders();
  const value = call(context, 'getReminderConfig_()');
  assert.deepEqual(JSON.parse(JSON.stringify(value)), {
    version: 1,
    enabled: false,
    sleepEnabled: false,
    caffeineEnabled: false,
    sleepTime: '08:00',
    caffeineTime: '20:00',
    includeWeekends: false,
    classPeriods: [
      { classId: '1', startDate: '', endDate: '' },
      { classId: '2', startDate: '', endDate: '' },
      { classId: '3', startDate: '', endDate: '' },
      { classId: '4', startDate: '', endDate: '' },
    ],
    updatedAt: '',
    updatedBy: '',
  });
});

test('saving reminder config normalizes values stamps actor and uses a script lock', async () => {
  const { context, spreadsheet, lockEvents } = await reminders();
  context.inputConfig = {
    enabled: true,
    sleepEnabled: true,
    caffeineEnabled: true,
    sleepTime: '8:00',
    caffeineTime: '20:00',
    includeWeekends: true,
    classPeriods: [
      { classId: '1', startDate: '2026-09-01', endDate: '2026-10-05' },
      { classId: '2', startDate: '2026-09-02', endDate: '2026-10-06' },
      { classId: '3', startDate: '2026-09-03', endDate: '2026-10-07' },
      { classId: '4', startDate: '2026-09-04', endDate: '2026-10-08' },
    ],
  };

  const saved = call(context, "saveReminderConfig_(inputConfig, 'teacher')");

  assert.equal(saved.sleepTime, '08:00');
  assert.equal(saved.updatedBy, 'teacher');
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(lockEvents, ['lock', 'unlock']);
  assert.equal(rows(spreadsheet, '알림설정').length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(call(context, 'getReminderConfig_()'))), JSON.parse(JSON.stringify(saved)));
});

test('reminder config reloads spreadsheet date cells as ISO calendar dates', async () => {
  const stored = [
    1, true, true, true,
    new Date('1970-01-01T23:00:00.000Z'), new Date('1970-01-01T11:00:00.000Z'), true,
    new Date('2026-10-19T00:00:00.000Z'), new Date('2026-11-22T00:00:00.000Z'),
    new Date('2026-10-23T00:00:00.000Z'), new Date('2026-11-26T00:00:00.000Z'),
    new Date('2026-10-13T00:00:00.000Z'), new Date('2026-11-16T00:00:00.000Z'),
    new Date('2026-10-13T00:00:00.000Z'), new Date('2026-11-16T00:00:00.000Z'),
    '2026-10-02T11:54:43.000Z', 'teacher',
  ];
  const { context } = await reminders({ '알림설정': [CONFIG_HEADERS, stored] });

  const loaded = JSON.parse(JSON.stringify(call(context, 'getReminderConfig_()')));

  assert.equal(loaded.sleepTime, '08:00');
  assert.equal(loaded.caffeineTime, '20:00');
  assert.deepEqual(loaded.classPeriods, [
    { classId: '1', startDate: '2026-10-19', endDate: '2026-11-22' },
    { classId: '2', startDate: '2026-10-23', endDate: '2026-11-26' },
    { classId: '3', startDate: '2026-10-13', endDate: '2026-11-16' },
    { classId: '4', startDate: '2026-10-13', endDate: '2026-11-16' },
  ]);
});

function enabledConfig() {
  return {
    enabled: true,
    sleepEnabled: true,
    caffeineEnabled: true,
    sleepTime: '08:00',
    caffeineTime: '20:00',
    includeWeekends: true,
    classPeriods: [1, 2, 3, 4].map((classId) => ({
      classId: String(classId), startDate: '2026-09-01', endDate: '2026-10-05',
    })),
  };
}

function pushRecord(endpoint, overrides = {}) {
  return {
    role: 'student',
    studentId: '1101',
    endpoint,
    keys: { p256dh: 'public-key', auth: 'auth-key' },
    sleepEnabled: true,
    caffeineEnabled: true,
    ...overrides,
  };
}

test('push subscription upsert hashes endpoints updates without duplicates and never stores student names', async () => {
  const { context, spreadsheet } = await reminders();
  context.first = pushRecord('https://push.example/device-a');
  const created = call(context, 'upsertPushSubscription_(first)');
  assert.match(created.subscriptionId, /^[a-f0-9]{64}$/);

  context.updated = pushRecord('https://push.example/device-a', { sleepEnabled: false });
  const updated = call(context, 'upsertPushSubscription_(updated)');
  assert.equal(updated.subscriptionId, created.subscriptionId);
  assert.equal(rows(spreadsheet, '푸시구독').length, 2);
  assert.equal(rows(spreadsheet, '푸시구독')[1].includes('홍길동'), false);
  assert.equal(call(context, `getPushPreferences_('${created.subscriptionId}', {studentId:'1101',name:'홍길동'})`).sleepEnabled, false);
});

test('push preferences and deactivation enforce subscription ownership', async () => {
  const { context } = await reminders();
  context.record = pushRecord('https://push.example/device-a');
  const created = call(context, 'upsertPushSubscription_(record)');
  context.subscriptionId = created.subscriptionId;
  context.preferences = { sleepEnabled: false, caffeineEnabled: true };
  context.owner = { studentId: '1101', name: '홍길동' };
  context.other = { studentId: '1201', name: '다른학생' };

  assert.throws(() => call(context, 'setPushPreferences_(subscriptionId, other, preferences)'), /REQUEST_REJECTED/);
  assert.equal(call(context, 'setPushPreferences_(subscriptionId, owner, preferences)').sleepEnabled, false);
  assert.throws(() => call(context, 'deactivatePushSubscription_(subscriptionId, other)'), /REQUEST_REJECTED/);
  assert.equal(call(context, 'deactivatePushSubscription_(subscriptionId, owner)').active, false);
});

test('one student can keep multiple active device subscriptions', async () => {
  const { context, spreadsheet } = await reminders();
  context.deviceA = pushRecord('https://push.example/device-a');
  context.deviceB = pushRecord('https://push.example/device-b');
  call(context, 'upsertPushSubscription_(deviceA)');
  call(context, 'upsertPushSubscription_(deviceB)');
  assert.equal(rows(spreadsheet, '푸시구독').length, 3);
});

test('dispatch snapshot uses named headers and returns only active minimal reminder data', async () => {
  const initial = {
    students: [
      ['학년', '반', '번호', '이름', '학번ID'],
      [1, 1, 1, '홍길동', 1101],
      [1, 2, 1, '김학생', 1201],
    ],
    sleep: [
      ['메모', '날짜', '전체학번', '성명'],
      ['private sleep note', '2026-09-09', 1101, '홍길동'],
    ],
    caffeine: [
      ['음료명', '전체학번', '섭취시간', '함량'],
      ['섭취 안 함', 1101, '2026-09-10 09:00:00', 0],
    ],
    알림발송로그: [DELIVERY_HEADERS, ['2026-09-09:sleep:device-old', '2026-09-09', 'sleep', 1101, 'device-old', 'now', 'success', '']],
  };
  const { context } = await reminders(initial);
  context.config = enabledConfig();
  call(context, "saveReminderConfig_(config, 'teacher')");
  context.active = pushRecord('https://push.example/device-a');
  context.inactive = pushRecord('https://push.example/device-b', { active: false });
  call(context, 'upsertPushSubscription_(active)');
  const inactive = call(context, 'upsertPushSubscription_(inactive)');
  call(context, `deactivatePushSubscription_('${inactive.subscriptionId}', {studentId:'1101',name:'홍길동'})`);

  const sleep = JSON.parse(JSON.stringify(call(context, "getReminderDispatchSnapshot_('sleep', '2026-09-10T08:00:00+09:00')")));
  const caffeine = JSON.parse(JSON.stringify(call(context, "getReminderDispatchSnapshot_('caffeine', '2026-09-10T20:00:00+09:00')")));

  assert.deepEqual(sleep.students, [
    { studentId: '1101', classId: '1' },
    { studentId: '1201', classId: '2' },
  ]);
  assert.deepEqual(sleep.completedStudentIds, ['1101']);
  assert.deepEqual(caffeine.completedStudentIds, ['1101']);
  assert.equal(sleep.subscriptions.length, 1);
  assert.deepEqual(sleep.successfulDeliveryKeys, ['2026-09-09:sleep:device-old']);
  assert.doesNotMatch(JSON.stringify(sleep), /홍길동|김학생|private sleep note|섭취 안 함/);
});

test('dispatch snapshot recognizes the production bedtime-date header across midnight', async () => {
  const initial = {
    students: [['학년', '반', '번호', '이름', '학번', '연구대상자코드'], [2, 1, 1, '테스트학생', 2101, 'R001']],
    sleep: [
      ['타임스탬프', '전체학번', '취침날짜', '기상날짜', '메모'],
      ['2026-10-09', 2101, '2026-10-08', '2026-10-09', 'private sleep note'],
      ['2026-10-09', 2102, '2026-10-07', '2026-10-08', 'earlier night'],
    ],
    caffeine: [['전체학번', '섭취시간']],
  };
  const { context, spreadsheet } = await reminders(initial);
  const snapshot = JSON.parse(JSON.stringify(call(context,
    "getReminderDispatchSnapshot_('sleep', '2026-10-09T08:00:00+09:00')")));

  assert.deepEqual(snapshot.students, [{ studentId: '2101', classId: '1' }]);
  assert.deepEqual(snapshot.completedStudentIds, ['2101']);
  assert.doesNotMatch(JSON.stringify(snapshot), /테스트학생|private sleep note|earlier night/);
  assert.deepEqual(rows(spreadsheet, 'sleep'), initial.sleep);
});

test('dispatch snapshot fails closed when required named headers are missing', async () => {
  const { context } = await reminders({
    students: [['이름'], ['홍길동']],
    sleep: [['전체학번', '날짜']],
    caffeine: [['전체학번', '섭취시간']],
  });
  context.config = enabledConfig();
  call(context, "saveReminderConfig_(config, 'teacher')");
  assert.throws(
    () => call(context, "getReminderDispatchSnapshot_('sleep', '2026-09-10T08:00:00+09:00')"),
    /REQUEST_REJECTED/,
  );
});

test('delivery claims are atomic while live and recover after lease expiry', async () => {
  const properties = {};
  const { context } = await reminders({}, { properties });
  context.keys = ['2026-09-09:sleep:device-a'];
  assert.deepEqual(JSON.parse(JSON.stringify(call(context,
    "claimReminderDeliveries_(keys, 'exec-a', '2026-09-10T08:00:00.000Z')"))), context.keys);
  assert.deepEqual(JSON.parse(JSON.stringify(call(context,
    "claimReminderDeliveries_(keys, 'exec-b', '2026-09-10T08:02:00.000Z')"))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(call(context,
    "claimReminderDeliveries_(keys, 'exec-c', '2026-09-10T08:06:00.000Z')"))), context.keys);
});

test('recording delivery results writes final-only logs and deactivates expired devices', async () => {
  const properties = {};
  const { context, spreadsheet } = await reminders({}, { properties });
  context.record = pushRecord('https://push.example/device-a');
  const created = call(context, 'upsertPushSubscription_(record)');
  context.key = `2026-09-09:sleep:${created.subscriptionId}`;
  context.keys = [context.key];
  call(context, "claimReminderDeliveries_(keys, 'exec-a', '2026-09-10T08:00:00.000Z')");
  context.results = [{
    deliveryKey: context.key,
    referenceDate: '2026-09-09',
    type: 'sleep',
    studentId: '1101',
    subscriptionId: created.subscriptionId,
    status: 'expired',
    errorCode: 'PUSH_SUBSCRIPTION_EXPIRED',
  }];

  call(context, 'recordReminderDeliveryResults_(results)');

  const log = rows(spreadsheet, '알림발송로그')[1];
  assert.equal(log[6], 'expired');
  assert.equal(log.includes('https://push.example/device-a'), false);
  assert.equal(rows(spreadsheet, '푸시구독')[1][8], false);
});

test('teacher reminder admin summary returns aggregate subscribers and latest run only', async () => {
  const initial = {
    students: [
      ['학년', '반', '번호', '이름', '학번ID'],
      [1, 1, 1, '홍길동', 1101],
      [1, 2, 1, '김학생', 1201],
    ],
    알림발송로그: [
      DELIVERY_HEADERS,
      ['old', '2026-09-08', 'sleep', 1101, 'old-device', '2026-09-09T08:10:00+09:00', 'success', ''],
      ['a', '2026-09-09', 'sleep', 1101, 'device-a', '2026-09-10T08:15:00+09:00', 'success', ''],
      ['b', '2026-09-09', 'sleep', 1101, 'device-b', '2026-09-10T08:15:00+09:00', 'expired', 'PUSH_SUBSCRIPTION_EXPIRED'],
      ['c', '2026-09-09', 'sleep', 1201, 'device-c', '2026-09-10T08:15:00+09:00', 'failed', 'PUSH_SERVER_ERROR'],
    ],
  };
  const { context } = await reminders(initial);
  context.config = enabledConfig();
  call(context, "saveReminderConfig_(config, 'teacher')");
  context.deviceA = pushRecord('https://push.example/device-a');
  context.deviceB = pushRecord('https://push.example/device-b');
  context.inactive = pushRecord('https://push.example/device-c', { studentId: '1201' });
  call(context, 'upsertPushSubscription_(deviceA)');
  call(context, 'upsertPushSubscription_(deviceB)');
  const inactive = call(context, 'upsertPushSubscription_(inactive)');
  call(context, `deactivatePushSubscription_('${inactive.subscriptionId}', {studentId:'1201',name:'김학생'})`);
  context.teacherDevice = pushRecord('https://push.example/teacher', { role: 'teacher-test', studentId: '' });
  call(context, 'saveTeacherTestSubscription_(teacherDevice)');

  const result = JSON.parse(JSON.stringify(call(context, 'getReminderAdminConfig_()')));
  assert.deepEqual(result.subscriberCounts, {
    students: 1,
    devices: 2,
    byClass: { 1: 2, 2: 0, 3: 0, 4: 0 },
  });
  assert.deepEqual(result.lastRun, {
    at: '2026-09-10T08:15:00+09:00', targeted: 3, sent: 1, expired: 1, failed: 1,
  });
  assert.doesNotMatch(JSON.stringify(result), /1101|1201|push\.example|auth-key/);
});

test('test student status resolves one trimmed exact name and returns aggregate device counts only', async () => {
  const { context } = await reminders({
    students: [
      ['학년', '반', '번호', '이름', '학번ID'],
      [1, 1, 1, ' 테스트 ', 1101],
      [1, 1, 2, '테스트1', 1102],
      [1, 1, 3, '테스트 학생', 1103],
    ],
  });
  context.sleepOnly = pushRecord('https://push.example/sleep-only', { caffeineEnabled: false });
  context.caffeineOnly = pushRecord('https://push.example/caffeine-only', { sleepEnabled: false });
  context.both = pushRecord('https://push.example/both');
  context.other = pushRecord('https://push.example/other', { studentId: '1102' });
  call(context, 'upsertPushSubscription_(sleepOnly)');
  call(context, 'upsertPushSubscription_(caffeineOnly)');
  call(context, 'upsertPushSubscription_(both)');
  call(context, 'upsertPushSubscription_(other)');

  const status = JSON.parse(JSON.stringify(call(context, 'getTestStudentReminderStatus_()')));

  assert.deepEqual(status, { name: '테스트', sleepDevices: 2, caffeineDevices: 2 });
  assert.doesNotMatch(JSON.stringify(status), /1101|push\.example|public-key|auth-key/);
});

test('test student resolution fails closed for missing duplicate and lookalike-only names', async () => {
  for (const studentRows of [
    [[1, 1, 1, '일반학생', 1101]],
    [[1, 1, 1, '테스트1', 1101], [1, 1, 2, '테스트 학생', 1102]],
    [[1, 1, 1, '테스트', 1101], [1, 1, 2, ' 테스트 ', 1102]],
  ]) {
    const { context } = await reminders({
      students: [['학년', '반', '번호', '이름', '학번ID'], ...studentRows],
    });
    assert.throws(() => call(context, 'getTestStudentReminderStatus_()'), /REQUEST_REJECTED/);
  }
});

test('test student targets include only active student devices enabled for the requested type', async () => {
  const { context } = await reminders({
    students: [['이름', '학번ID'], ['테스트', 1101], ['다른학생', 1201]],
  });
  context.sleep = pushRecord('https://push.example/sleep', { caffeineEnabled: false });
  context.caffeine = pushRecord('https://push.example/caffeine', { sleepEnabled: false });
  context.inactive = pushRecord('https://push.example/inactive', { active: false });
  context.other = pushRecord('https://push.example/other', { studentId: '1201' });
  context.teacher = pushRecord('https://push.example/teacher', { role: 'teacher-test', studentId: '' });
  call(context, 'upsertPushSubscription_(sleep)');
  call(context, 'upsertPushSubscription_(caffeine)');
  call(context, 'upsertPushSubscription_(inactive)');
  call(context, 'upsertPushSubscription_(other)');
  call(context, 'saveTeacherTestSubscription_(teacher)');

  const sleepTargets = JSON.parse(JSON.stringify(call(context, "getTestStudentReminderTargets_('sleep')")));
  const caffeineTargets = JSON.parse(JSON.stringify(call(context, "getTestStudentReminderTargets_('caffeine')")));

  assert.equal(sleepTargets.name, '테스트');
  assert.equal(sleepTargets.subscriptions.length, 1);
  assert.equal(sleepTargets.subscriptions[0].endpoint, 'https://push.example/sleep');
  assert.equal(caffeineTargets.subscriptions.length, 1);
  assert.equal(caffeineTargets.subscriptions[0].endpoint, 'https://push.example/caffeine');
  assert.throws(() => call(context, "getTestStudentReminderTargets_('all')"), /REQUEST_REJECTED/);
});

test('test student result recording requires manual keys and deactivates only expired devices', async () => {
  const { context, spreadsheet } = await reminders({
    students: [['이름', '학번ID'], ['테스트', 1101]],
  });
  context.first = pushRecord('https://push.example/first');
  context.second = pushRecord('https://push.example/second');
  const first = call(context, 'upsertPushSubscription_(first)');
  const second = call(context, 'upsertPushSubscription_(second)');
  context.results = [
    {
      deliveryKey: `manual-test:req-1:sleep:${first.subscriptionId}`,
      studentId: '1101', subscriptionId: first.subscriptionId,
      status: 'success', errorCode: '',
    },
    {
      deliveryKey: `manual-test:req-1:sleep:${second.subscriptionId}`,
      studentId: '1101', subscriptionId: second.subscriptionId,
      status: 'expired', errorCode: 'PUSH_SUBSCRIPTION_EXPIRED',
    },
  ];

  assert.throws(
    () => call(context, "recordTestStudentReminderResults_('sleep', '2026-09-28', [{deliveryKey:'2026-09-28:sleep:device',studentId:'1101',subscriptionId:'device',status:'success',errorCode:''}])"),
    /REQUEST_REJECTED/,
  );
  const recorded = call(context, "recordTestStudentReminderResults_('sleep', '2026-09-28', results)");

  assert.equal(recorded.recorded, 2);
  assert.equal(rows(spreadsheet, '알림발송로그')[1][0].startsWith('manual-test:'), true);
  assert.equal(rows(spreadsheet, '푸시구독')[1][8], true);
  assert.equal(rows(spreadsheet, '푸시구독')[2][8], false);
});
