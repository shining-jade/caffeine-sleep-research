import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryKey,
  getKstClock,
  normalizeReminderConfig,
  previousKstDate,
  selectReminderCandidates,
} from '../api/_lib/reminder-policy.js';

const SLEEP_NOW = Date.UTC(2026, 8, 9, 23, 10); // 2026-09-10 08:10 KST
const CAFFEINE_NOW = Date.UTC(2026, 8, 10, 11, 20); // 2026-09-10 20:20 KST

function config(overrides = {}) {
  return normalizeReminderConfig({
    enabled: true,
    sleepEnabled: true,
    caffeineEnabled: true,
    sleepTime: '8:00',
    caffeineTime: '20:00',
    includeWeekends: true,
    classPeriods: [
      { classId: '1', startDate: '2026-09-01', endDate: '2026-10-05' },
      { classId: '2', startDate: '2026-09-15', endDate: '2026-10-05' },
    ],
    ...overrides,
  });
}

function subscription(overrides = {}) {
  return {
    studentId: '1101',
    subscriptionId: 'device-a',
    endpoint: 'https://push.example/device-a',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
    active: true,
    sleepEnabled: true,
    caffeineEnabled: true,
    ...overrides,
  };
}

function candidates(overrides = {}) {
  return selectReminderCandidates({
    type: 'sleep',
    nowMs: SLEEP_NOW,
    config: config(),
    students: [
      { studentId: '1101', name: '학생1', classId: '1' },
      { studentId: '1201', name: '학생2', classId: '2' },
    ],
    completedStudentIds: [],
    subscriptions: [subscription()],
    successfulDeliveryKeys: [],
    ...overrides,
  });
}

test('KST clock crosses the UTC day boundary without using server local time', () => {
  assert.deepEqual(getKstClock(Date.UTC(2026, 7, 31, 15, 5)), {
    date: '2026-09-01',
    hour: 0,
    weekday: 2,
  });
});

test('KST clock reports Saturday and Sunday weekday numbers', () => {
  assert.equal(getKstClock(Date.UTC(2026, 8, 4, 15)).weekday, 6);
  assert.equal(getKstClock(Date.UTC(2026, 8, 5, 15)).weekday, 0);
});

test('previous day handles month and year boundaries', () => {
  assert.equal(previousKstDate('2026-03-01'), '2026-02-28');
  assert.equal(previousKstDate('2026-01-01'), '2025-12-31');
});

test('whole-hour reminder config is normalized and class IDs become strings', () => {
  const normalized = config();
  assert.equal(normalized.sleepTime, '08:00');
  assert.equal(normalized.caffeineTime, '20:00');
  assert.deepEqual(normalized.classPeriods[0], {
    classId: '1', startDate: '2026-09-01', endDate: '2026-10-05',
  });
});

test('whole-hour config rejects invalid times and class date ranges', () => {
  for (const value of ['08:30', '24:00', '', null]) {
    assert.throws(() => config({ sleepTime: value }), /invalid reminder config/i);
  }
  assert.throws(() => config({
    classPeriods: [{ classId: '1', startDate: '', endDate: '2026-10-01' }],
  }), /invalid reminder config/i);
  assert.throws(() => config({
    classPeriods: [{ classId: '1', startDate: '2026-10-02', endDate: '2026-10-01' }],
  }), /invalid reminder config/i);
});

test('delivery key is stable for one date type and device', () => {
  assert.equal(deliveryKey({
    referenceDate: '2026-09-09', type: 'sleep', subscriptionId: 'device-a',
  }), '2026-09-09:sleep:device-a');
});

test('sleep reminder selects only active opted-in devices in an active class', () => {
  assert.deepEqual(candidates(), [{
    studentId: '1101',
    subscriptionId: 'device-a',
    endpoint: 'https://push.example/device-a',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
    referenceDate: '2026-09-09',
    type: 'sleep',
  }]);
  assert.equal(JSON.stringify(candidates()).includes('학생1'), false);
});

test('reminder candidate selection fails closed when disabled or outside its hour', () => {
  assert.deepEqual(candidates({ config: config({ enabled: false }) }), []);
  assert.deepEqual(candidates({ config: config({ sleepEnabled: false }) }), []);
  assert.deepEqual(candidates({ nowMs: Date.UTC(2026, 8, 9, 22, 10) }), []);
});

test('reminder candidate honors class boundary dates and weekend exclusion', () => {
  const boundaryConfig = config({
    classPeriods: [{ classId: '1', startDate: '2026-09-10', endDate: '2026-09-10' }],
  });
  assert.equal(candidates({ config: boundaryConfig }).length, 1);

  const saturday = Date.UTC(2026, 8, 4, 23); // 2026-09-05 08:00 KST
  assert.deepEqual(candidates({ nowMs: saturday, config: config({ includeWeekends: false }) }), []);
});

test('sleep reminder skips students with previous-day sleep completion', () => {
  assert.deepEqual(candidates({ completedStudentIds: ['1101'] }), []);
});

test('caffeine reminder treats a no-intake completion ID as complete', () => {
  assert.deepEqual(candidates({
    type: 'caffeine',
    nowMs: CAFFEINE_NOW,
    completedStudentIds: ['1101'],
  }), []);
});

test('reminder candidate honors per-device preferences and active state', () => {
  assert.deepEqual(candidates({ subscriptions: [subscription({ sleepEnabled: false })] }), []);
  assert.deepEqual(candidates({ subscriptions: [subscription({ active: false })] }), []);
  assert.deepEqual(candidates({
    type: 'caffeine',
    nowMs: CAFFEINE_NOW,
    subscriptions: [subscription({ caffeineEnabled: false })],
  }), []);
});

test('reminder candidate keeps multiple devices but deduplicates subscription IDs', () => {
  const deviceB = subscription({
    subscriptionId: 'device-b',
    endpoint: 'https://push.example/device-b',
  });
  const result = candidates({ subscriptions: [subscription(), subscription(), deviceB] });
  assert.deepEqual(result.map((item) => item.subscriptionId), ['device-a', 'device-b']);
});

test('reminder candidate skips an existing successful delivery key', () => {
  assert.deepEqual(candidates({
    successfulDeliveryKeys: ['2026-09-09:sleep:device-a'],
  }), []);
});
