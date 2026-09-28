import assert from 'node:assert/strict';
import test from 'node:test';

import { createPushReminders, parseReminderDeepLink } from '../public/js/push-reminders.js';

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function harness({
  permission = 'default',
  requestResult = 'granted',
  environment = 'android-chrome',
  existingSubscription = null,
  supported = true,
  search = '',
} = {}) {
  const calls = [];
  const subscription = existingSubscription || {
    endpoint: 'https://push.example/student-device',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'public-key', auth: 'auth-key' } }; },
    async unsubscribe() { calls.push(['browser-unsubscribe']); return true; },
  };
  const pushManager = {
    async getSubscription() { return existingSubscription; },
    async subscribe(options) { calls.push(['browser-subscribe', options]); return subscription; },
  };
  const registration = { pushManager };
  let permissionRequests = 0;
  const NotificationRef = supported ? {
    permission,
    async requestPermission() { permissionRequests += 1; this.permission = requestResult; return requestResult; },
  } : undefined;
  const navigatorRef = supported ? {
    userAgent: environment === 'ios-safari' ? 'Mozilla/5.0 (iPhone) Version/18 Mobile Safari/604.1' : 'Android Chrome/140',
    serviceWorker: { async register() { calls.push(['register']); return registration; } },
    PushManager: function PushManager() {},
  } : {};
  const localStorageRef = storage();
  const sessionStorageRef = storage();
  const opened = [];
  const states = [];
  const api = {
    async getConfig() { calls.push(['config']); return { success: true, publicKey: 'AQID', sleepTime: '08:00', caffeineTime: '20:00', globallyEnabled: false }; },
    async subscribe(value) { calls.push(['api-subscribe', value]); return { success: true, subscriptionId: 'a'.repeat(64) }; },
    async getPreferences(id) { calls.push(['get-preferences', id]); return { success: true, subscriptionId: id, sleepEnabled: true, caffeineEnabled: false, active: true }; },
    async savePreferences(value) { calls.push(['save-preferences', value]); return { success: true, ...value, active: true }; },
    async unsubscribe(value) { calls.push(['api-unsubscribe', value]); return { success: true }; },
  };
  const controller = createPushReminders({
    api,
    navigatorRef,
    NotificationRef,
    PushManagerRef: supported ? function PushManager() {} : undefined,
    localStorageRef,
    sessionStorageRef,
    locationRef: { search, pathname: '/', hash: '' },
    historyRef: { replaceState() {} },
    detectEnvironment: () => environment,
    openInstallGuide: () => calls.push(['install-guide']),
    openRecord: (value) => opened.push(value),
    hashEndpoint: async () => 'a'.repeat(64),
    onState: (value) => states.push(value),
  });
  return { controller, calls, states, opened, getPermissionRequests: () => permissionRequests };
}

test('student reminder client stays usable when push is unsupported', async () => {
  const { controller, states, getPermissionRequests } = harness({ supported: false });
  await controller.initialize({ studentId: '1101' });
  const state = await controller.enable();
  assert.equal(state.status, 'unsupported');
  assert.equal(getPermissionRequests(), 0);
  assert.equal(states.at(-1).endpoint, undefined);
});

test('not-installed iOS opens installation guidance without prompting for permission', async () => {
  const { controller, calls, getPermissionRequests } = harness({ environment: 'ios-safari' });
  const state = await controller.enable();
  assert.equal(state.status, 'needs-install');
  assert.deepEqual(calls, [['install-guide']]);
  assert.equal(getPermissionRequests(), 0);
});

test('Naver in-app browser directs to the browser guide without prompting for permission', async () => {
  const { controller, calls, getPermissionRequests } = harness({ environment: 'naver' });
  const state = await controller.enable();
  assert.equal(state.status, 'needs-browser');
  assert.deepEqual(calls, [['install-guide']]);
  assert.equal(getPermissionRequests(), 0);
});

test('enable requests permission only in the click flow and registers the current device', async () => {
  const { controller, calls, states, getPermissionRequests } = harness();
  await controller.initialize({ studentId: '1101' });
  assert.equal(getPermissionRequests(), 0);
  const state = await controller.enable();
  assert.equal(getPermissionRequests(), 1);
  assert.equal(state.status, 'enabled');
  assert.equal(state.sleepEnabled, true);
  assert.equal(state.caffeineEnabled, true);
  assert.ok(calls.some(([name]) => name === 'api-subscribe'));
  assert.doesNotMatch(JSON.stringify(states), /push\.example|public-key|auth-key/);
});

test('denied permission is reported and never automatically prompted again', async () => {
  const { controller, getPermissionRequests } = harness({ requestResult: 'denied' });
  assert.equal((await controller.enable()).status, 'denied');
  assert.equal(getPermissionRequests(), 1);
  await controller.initialize({ studentId: '1101' });
  assert.equal(getPermissionRequests(), 1);
  assert.equal(controller.permissionState(), 'denied');
});

test('existing subscription loads and saves independent morning and evening preferences', async () => {
  const existing = {
    endpoint: 'https://push.example/student-device',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'public-key', auth: 'auth-key' } }; },
    async unsubscribe() { return true; },
  };
  const { controller, calls } = harness({ permission: 'granted', existingSubscription: existing });
  const loaded = await controller.initialize({ studentId: '1101' });
  assert.equal(loaded.sleepEnabled, true);
  assert.equal(loaded.caffeineEnabled, false);
  const saved = await controller.savePreferences({ sleepEnabled: false, caffeineEnabled: true });
  assert.equal(saved.sleepEnabled, false);
  assert.equal(saved.caffeineEnabled, true);
  assert.ok(calls.some(([name, value]) => name === 'save-preferences' && value.caffeineEnabled === true));
});

test('unsubscribe deactivates only the current endpoint and returns it for logout cleanup', async () => {
  const existing = {
    endpoint: 'https://push.example/student-device',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'public-key', auth: 'auth-key' } }; },
    async unsubscribe() { return true; },
  };
  const { controller, calls } = harness({ permission: 'granted', existingSubscription: existing });
  const endpoint = await controller.unsubscribeCurrentDevice();
  assert.equal(endpoint, existing.endpoint);
  assert.ok(calls.some(([name, value]) => name === 'api-unsubscribe' && value.endpoint === existing.endpoint));
});

test('deep links accept only known record types and real ISO calendar dates', async () => {
  assert.deepEqual(parseReminderDeepLink('?open=sleep&date=2026-09-09'), { type: 'sleep', date: '2026-09-09' });
  assert.deepEqual(parseReminderDeepLink('?open=caffeine&date=2026-12-31'), { type: 'caffeine', date: '2026-12-31' });
  assert.equal(parseReminderDeepLink('?open=teacher&date=2026-09-09'), null);
  assert.equal(parseReminderDeepLink('?open=sleep&date=2026-02-30'), null);

  const { controller, opened } = harness({ search: '?open=sleep&date=2026-09-09' });
  assert.equal(opened.length, 0);
  await controller.initialize({ studentId: '1101' });
  assert.deepEqual(opened, [{ type: 'sleep', date: '2026-09-09' }]);
});
