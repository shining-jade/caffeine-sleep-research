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
  assert.equal(states.length, 1);
});

test('save requires valid explicit form values and reloads server state', async () => {
  const { controller, calls } = harness();
  await controller.initialize();
  await controller.saveConfig();
  const saved = calls.find(([name]) => name === 'save-config')[1];
  assert.equal(saved.enabled, true);
  assert.equal(saved.includeWeekends, false);
  assert.equal(calls.filter(([name]) => name === 'get-config').length, 2);
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
