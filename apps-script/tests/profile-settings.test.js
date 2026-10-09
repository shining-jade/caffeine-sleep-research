import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemorySpreadsheet, loadAppsScript } from './harness.js';

test('student profile normalizes Date cells, text times and midnight to HTML time values', async () => {
  const cases = [
    [new Date('2026-10-08T14:00:00Z'), new Date('2026-10-08T22:00:00Z'), '23:00', '07:00'],
    ['7:05:00', '23:30', '07:05', '23:30'],
    [0, 7 / 24, '00:00', '07:00'],
  ];
  for (const [bed, wake, expectedBed, expectedWake] of cases) {
    const sheet = createMemorySpreadsheet({ info: [Array(11).fill('header'), ['', '', '', '', '테스트', '0', 68, 150, bed, wake, 'teen']] });
    const { context } = await loadAppsScript({ files: ['Code.gs'], globals: { getSpreadsheet_: () => sheet, safeLog_() {} } });
    const profile = context.getWeightData('0');
    assert.equal(profile.targetBedtime, expectedBed); assert.equal(profile.targetWakeTime, expectedWake);
  }
});

test('invalid goals are rejected by the Apps Script gateway before storage or ledger access', async () => {
  const { context } = await loadAppsScript({ globals: { saveInitialSetup: payload => payload } });
  const base = { weight: 68, targetCaf: 150, targetBedtime: '23:00', targetWakeTime: '07:00', ageGroup: 'teen' };
  for (const patch of [{ targetCaf: 0 }, { targetCaf: -1 }, { targetCaf: 1001 }, { targetCaf: 1.5 }, { weight: Infinity }, { targetBedtime: '25:00' }]) {
    assert.throws(() => context.dispatchStudentAction_('saveInitialSetup', [{ ...base, ...patch }], { studentId: '0', name: '테스트' }), /REQUEST_REJECTED/);
  }
});
