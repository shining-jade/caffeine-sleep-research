import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTeacherReminders,
  normalizeTeacherReminderForm,
  wholeHourOptions,
} from '../public/js/teacher-reminders.js';

function config(overrides = {}) {
  return {
    enabled: false,
    sleepEnabled: true,
    caffeineEnabled: true,
    sleepTime: '08:00',
    caffeineTime: '20:00',
    includeWeekends: true,
    classPeriods: [1, 2, 3, 4].map((classId) => ({
      classId: String(classId), startDate: '2026-09-01', endDate: '2026-10-05',
    })),
    ...overrides,
  };
}

function harness() {
  const calls = [];
  const states = [];
  const subscription = {
    endpoint: 'https://push.example/teacher-device',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'public-key', auth: 'auth-key' } }; },
  };
  const registration = {
    pushManager: {
      async getSubscription() { return null; },
      async subscribe() { calls.push(['browser-subscribe']); return subscription; },
    },
  };
  const api = {
    async getConfig() {
      calls.push(['get-config']);
      return {
        success: true,
        publicKey: 'AQID',
        config: config(),
        subscriberCounts: { students: 12, devices: 14, byClass: { 1: 4, 2: 3, 3: 4, 4: 3 } },
        lastRun: { at: '2026-09-09T20:01:00+09:00', targeted: 5, sent: 4, expired: 1, failed: 0 },
        nextRuns: { sleep: '2026-09-10T08:00:00+09:00', caffeine: '2026-09-10T20:00:00+09:00' },
        studentIds: ['1101'],
      };
    },
    async saveConfig(value) { calls.push(['save-config', value]); return { success: true, config: value }; },
    async testSubscribe(value) { calls.push(['test-subscribe', value]); return { success: true, subscriptionId: 'safe-id' }; },
    async testSend(type, value) { calls.push(['test-send', type, value]); return { success: true, status: 'success' }; },
    async getTestStudent() {
      calls.push(['get-test-student']);
      return { success: true, name: '테스트', sleepDevices: 1, caffeineDevices: 2, studentId: '1101' };
    },
    async sendTestStudent(type) {
      calls.push(['send-test-student', type]);
      return { success: true, type, targeted: 2, sent: 1, expired: 1, failed: 0, endpoint: 'https://push.example/private' };
    },
  };
  const NotificationRef = {
    permission: 'default',
    async requestPermission() { calls.push(['permission']); this.permission = 'granted'; return 'granted'; },
  };
  const controller = createTeacherReminders({
    api,
    navigatorRef: { serviceWorker: { async register() { calls.push(['register']); return registration; } } },
    NotificationRef,
    PushManagerRef: function PushManager() {},
    readForm: () => config({ enabled: true, includeWeekends: false }),
    onState: (state) => states.push(state),
  });
  return { controller, calls, states };
}

test('teacher reminder UI offers exactly 24 whole-hour choices', () => {
  assert.deepEqual(wholeHourOptions(), Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`));
});

test('teacher reminder form accepts four classes and rejects missing reversed or non-hour values', () => {
  assert.deepEqual(normalizeTeacherReminderForm(config()), config());
  for (const value of [
    config({ sleepTime: '08:30' }),
    config({ classPeriods: config().classPeriods.slice(0, 3) }),
    config({ classPeriods: [{ classId: '1', startDate: '', endDate: '' }, ...config().classPeriods.slice(1)] }),
    config({ classPeriods: [{ classId: '1', startDate: '2026-10-02', endDate: '2026-10-01' }, ...config().classPeriods.slice(1)] }),
  ]) assert.throws(() => normalizeTeacherReminderForm(value));
});

test('initial load renders disabled config aggregate status and no student identifiers', async () => {
  const { controller, states } = harness();
  const state = await controller.initialize();
  assert.equal(state.config.enabled, false);
  assert.equal(state.subscriberCounts.students, 12);
  assert.equal(state.subscriberCounts.devices, 14);
  assert.equal(state.lastRun.sent, 4);
  assert.equal(state.nextRuns.sleep, '2026-09-10T08:00:00+09:00');
  assert.doesNotMatch(JSON.stringify(states), /1101|push\.example|auth-key|public-key/);
});

test('initial disabled config may render blank class dates but cannot be saved blank', async () => {
  const { controller } = harness();
  controller.getState();
  const blank = config({
    classPeriods: config().classPeriods.map((period) => ({ ...period, startDate: '', endDate: '' })),
  });
  const states = [];
  const blankController = createTeacherReminders({
    api: { async getConfig() { return { config: blank }; } },
    onState: (state) => states.push(state),
  });
  const state = await blankController.initialize();
  assert.equal(state.config.enabled, false);
  assert.equal(state.config.classPeriods[0].startDate, '');
  assert.throws(() => normalizeTeacherReminderForm(blank));
  assert.ok(states.length >= 1);
  assert.deepEqual(states.at(-1).config.classPeriods, blank.classPeriods);
});

test('save requires valid explicit form values and reloads server state', async () => {
  const { controller, calls, states } = harness();
  await controller.initialize();
  await controller.saveConfig();
  const saved = calls.find(([name]) => name === 'save-config')[1];
  const saving = states.find((state) => state.status === 'saving');
  assert.equal(saved.enabled, true);
  assert.equal(saved.includeWeekends, false);
  assert.equal(saving.config.enabled, true);
  assert.equal(saving.config.classPeriods[0].startDate, '2026-09-01');
  assert.equal(calls.filter(([name]) => name === 'get-config').length, 2);
});

test('successful save stays confirmed when the follow-up refresh fails', async () => {
  const states = [];
  let reads = 0;
  const initial = config({ enabled: false });
  const draft = config({ enabled: true, includeWeekends: false });
  const controller = createTeacherReminders({
    api: {
      async getConfig() {
        reads += 1;
        if (reads > 1) throw new Error('refresh failed');
        return { config: initial };
      },
      async saveConfig(value) { return { success: true, config: value }; },
      async getTestStudent() { return { sleepDevices: 0, caffeineDevices: 0 }; },
    },
    readForm: () => draft,
    onState: (state) => states.push(state),
  });
  await controller.initialize();

  const saved = await controller.saveConfig();

  assert.equal(saved.status, 'saved');
  assert.deepEqual(saved.config, draft);
  assert.equal(states.at(-1).status, 'saved');
});

test('successful save resolves before the background dashboard refresh finishes', async () => {
  let reads = 0;
  let markRefreshStarted;
  let finishRefresh;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  const refreshPending = new Promise((resolve) => { finishRefresh = resolve; });
  const draft = config({ enabled: true, includeWeekends: false });
  const states = [];
  const controller = createTeacherReminders({
    api: {
      async getConfig() {
        reads += 1;
        if (reads === 1) return { config: config({ enabled: false }) };
        markRefreshStarted();
        return refreshPending;
      },
      async saveConfig(value) { return { success: true, config: value }; },
      async getTestStudent() { return { sleepDevices: 0, caffeineDevices: 0 }; },
    },
    readForm: () => draft,
    onState: (state) => states.push(state),
  });
  await controller.initialize();

  let settled = false;
  const saving = controller.saveConfig().then((value) => {
    settled = true;
    return value;
  });
  await refreshStarted;
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(settled, true);
  assert.equal((await saving).status, 'saved');
  assert.equal(states.at(-1).status, 'saved');
  finishRefresh({
    config: draft,
    subscriberCounts: { students: 15, devices: 18, byClass: { 1: 5, 2: 4, 3: 5, 4: 4 } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().subscriberCounts.devices, 18);
});

test('repeated saves share one in-flight request', async () => {
  let finishSave;
  let saves = 0;
  const pendingSave = new Promise((resolve) => { finishSave = resolve; });
  const draft = config({ enabled: true });
  const controller = createTeacherReminders({
    api: {
      async getConfig() { return { config: draft }; },
      async saveConfig() { saves += 1; return pendingSave; },
      async getTestStudent() { return { sleepDevices: 0, caffeineDevices: 0 }; },
    },
    readForm: () => draft,
  });
  await controller.initialize();

  const first = controller.saveConfig();
  const repeated = controller.saveConfig();

  assert.equal(first, repeated);
  assert.equal(saves, 1);
  finishSave({ success: true, config: draft });
  await first;
});

test('a late refresh from an earlier save cannot overwrite a newer saved config', async () => {
  let reads = 0;
  let finishFirstRefresh;
  const firstRefresh = new Promise((resolve) => { finishFirstRefresh = resolve; });
  const firstDraft = config({ enabled: true, caffeineTime: '19:00' });
  const secondDraft = config({ enabled: true, caffeineTime: '21:00' });
  let draft = firstDraft;
  const controller = createTeacherReminders({
    api: {
      async getConfig() {
        reads += 1;
        if (reads === 1) return { config: config({ enabled: false }) };
        if (reads === 2) return firstRefresh;
        return { config: secondDraft };
      },
      async saveConfig(value) { return { success: true, config: value }; },
      async getTestStudent() { return { sleepDevices: 0, caffeineDevices: 0 }; },
    },
    readForm: () => draft,
  });
  await controller.initialize();

  await controller.saveConfig();
  draft = secondDraft;
  await controller.saveConfig();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().config.caffeineTime, '21:00');

  finishFirstRefresh({ config: firstDraft });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getState().config.caffeineTime, '21:00');
});

test('teacher test notification registers and sends only to the current browser', async () => {
  const { controller, calls } = harness();
  await controller.initialize();
  await controller.registerTestDevice();
  await controller.sendTest('sleep');
  assert.deepEqual(calls.filter(([name]) => name === 'permission').length, 1);
  assert.ok(calls.some(([name]) => name === 'test-subscribe'));
  const send = calls.find(([name]) => name === 'test-send');
  assert.equal(send[1], 'sleep');
  assert.equal(send[2].endpoint, 'https://push.example/teacher-device');
  await assert.rejects(() => controller.sendTest('all'));
});

test('test student status exposes only fixed name and aggregate type counts', async () => {
  const { controller, states, calls } = harness();
  const state = await controller.initialize();

  assert.deepEqual(state.testStudent, {
    status: 'ready', name: '테스트', sleepDevices: 1, caffeineDevices: 2,
    sendingType: null, result: null, error: '',
  });
  assert.equal(calls.filter(([name]) => name === 'get-test-student').length, 1);
  assert.doesNotMatch(JSON.stringify(states), /1101|push\.example/);
});

test('test student status can refresh before reminder config has loaded', async () => {
  const states = [];
  const controller = createTeacherReminders({
    api: {
      async getTestStudent() { return { name: '테스트', sleepDevices: 1, caffeineDevices: 1 }; },
    },
    onState: (state) => states.push(state),
  });

  const state = await controller.refreshTestStudent();

  assert.equal(state.config.enabled, false);
  assert.equal(state.config.sleepTime, '08:00');
  assert.equal(state.config.caffeineTime, '20:00');
  assert.equal(state.testStudent.status, 'ready');
  assert.equal(state.testStudent.sleepDevices, 1);
  assert.equal(state.testStudent.caffeineDevices, 1);
  assert.ok(states.length >= 2);
});

test('test student send rejects zero-device types and keeps aggregate results only', async () => {
  const calls = [];
  const states = [];
  const controller = createTeacherReminders({
    api: {
      async getConfig() { return { config: config() }; },
      async getTestStudent() { return { name: '테스트', sleepDevices: 0, caffeineDevices: 1 }; },
      async sendTestStudent(type) {
        calls.push(type);
        return { type, targeted: 1, sent: 1, expired: 0, failed: 0, studentId: '1101' };
      },
    },
    onState: (state) => states.push(state),
  });
  await controller.initialize();

  await assert.rejects(() => controller.sendTestStudent('sleep'), /등록된 기기/);
  const sent = await controller.sendTestStudent('caffeine');

  assert.deepEqual(calls, ['caffeine']);
  assert.deepEqual(sent.testStudent.result, { targeted: 1, sent: 1, expired: 0, failed: 0 });
  assert.equal(sent.testStudent.sendingType, null);
  assert.doesNotMatch(JSON.stringify(states), /1101/);
});

test('test student send locks repeated taps and always releases the sending state', async () => {
  let release;
  let sends = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const states = [];
  const controller = createTeacherReminders({
    api: {
      async getConfig() { return { config: config() }; },
      async getTestStudent() { return { name: '테스트', sleepDevices: 1, caffeineDevices: 1 }; },
      async sendTestStudent() { sends += 1; return pending; },
    },
    onState: (state) => states.push(state),
  });
  await controller.initialize();

  const first = controller.sendTestStudent('sleep');
  const repeated = controller.sendTestStudent('sleep');
  assert.equal(first, repeated);
  assert.equal(sends, 1);
  await assert.rejects(() => controller.sendTestStudent('caffeine'), /진행 중/);
  release({ type: 'sleep', targeted: 1, sent: 1, expired: 0, failed: 0 });
  const completed = await first;

  assert.equal(completed.testStudent.status, 'sent');
  assert.equal(completed.testStudent.sendingType, null);
  assert.ok(states.some((state) => state.testStudent.sendingType === 'sleep'));
});

test('test student refresh and send errors use fixed safe messages', async () => {
  let failRefresh = true;
  const controller = createTeacherReminders({
    api: {
      async getConfig() { return { config: config() }; },
      async getTestStudent() {
        if (failRefresh) throw new Error('private gateway detail 1101');
        return { name: '테스트', sleepDevices: 1, caffeineDevices: 0 };
      },
      async sendTestStudent() { throw new Error('private provider endpoint'); },
    },
  });
  const initial = await controller.initialize();
  assert.equal(initial.testStudent.error, '테스트 학생 연결 상태를 확인하지 못했습니다.');
  assert.doesNotMatch(JSON.stringify(initial), /1101|gateway/);

  failRefresh = false;
  await controller.refreshTestStudent();
  await assert.rejects(() => controller.sendTestStudent('sleep'));
  const failed = controller.getState();
  assert.equal(failed.testStudent.error, '테스트 학생 알림 요청을 처리하지 못했습니다.');
  assert.equal(failed.testStudent.sendingType, null);
  assert.doesNotMatch(JSON.stringify(failed), /endpoint|provider/);
});

test('config loading retains confirmed data and identifies unknown initial values', async () => {
  let resolveConfig;
  const states = [];
  const api = { getConfig: () => new Promise(resolve => { resolveConfig = resolve; }) };
  const controller = createTeacherReminders({ api, onState: state => states.push(state) });
  const first = controller.initialize();
  assert.equal(states.at(-1).status, 'loading');
  assert.equal(states.at(-1).hasLoadedConfig, false);
  resolveConfig({ config: config(), subscriberCounts: { students: 5, devices: 6 } });
  await first;
  const next = controller.initialize();
  assert.equal(states.at(-1).status, 'loading');
  assert.equal(states.at(-1).hasLoadedConfig, true);
  assert.equal(states.at(-1).subscriberCounts.students, 5);
  assert.equal(states.at(-1).config.classPeriods[0].startDate, '2026-09-01');
  resolveConfig({ config: config(), subscriberCounts: { students: 5, devices: 6 } });
  await next;
});

test('config refresh failure keeps the confirmed dates and reports failure', async () => {
  let fail = false;
  const controller = createTeacherReminders({ api: { async getConfig() {
    if (fail) throw new Error('offline');
    return { config: config(), subscriberCounts: { students: 5 } };
  } } });
  await controller.initialize();
  fail = true;
  await assert.rejects(controller.initialize(), /offline/);
  assert.equal(controller.getState().status, 'load-error');
  assert.equal(controller.getState().subscriberCounts.students, 5);
  assert.equal(controller.getState().config.classPeriods[0].startDate, '2026-09-01');
});
