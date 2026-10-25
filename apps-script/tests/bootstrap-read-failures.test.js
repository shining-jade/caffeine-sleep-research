import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemorySpreadsheet, event, loadAppsScript, outputJson } from './harness.js';

function fixture() {
  return createMemorySpreadsheet({
    info: [Array(11).fill('header'), ['', '', '', '', 'Synthetic', '0', 60, 150, '23:00', '07:00', 'teen']],
    caffeine: [Array(15).fill('header'), ['', '', '', '', '0', 'Synthetic', 'coffee', 1, '2026-10-11 12:00:00', 'caf-id']],
    sleep: [Array(19).fill('header'), ['', '', '', '', '0', 'Synthetic', '2026-10-10', '23:00', '2026-10-11', '07:00', 8, 'ok', 'test', 'sleep-id']],
  });
}

async function setup(sheet, globals = {}) {
  const loaded = await loadAppsScript({
    files: ['Code.gs', 'Security.gs', 'Ownership.gs', 'Sync.gs', 'Api.gs'],
    properties: { GAS_SHARED_SECRET: 'synthetic-secret' },
    globals: { getSpreadsheet_: () => sheet, syncProfileState_: () => ({ version: 'test-version' }), ...globals },
  });
  return loaded.context;
}

test('bootstrap never converts a failed profile, stats or history read into an empty successful snapshot', async () => {
  for (const [name, failOnRead] of [['info', 1], ['caffeine', 1], ['sleep', 1], ['caffeine', 2], ['sleep', 2]]) {
    const sheet = fixture();
    const target = sheet.getSheetByName(name);
    const originalRange = target.getRange.bind(target);
    let reads = 0;
    target.getRange = (...args) => {
      const range = originalRange(...args);
      const originalValues = range.getValues.bind(range);
      range.getValues = () => {
        reads++;
        if (reads === failOnRead) throw new Error('Service unavailable: private-data');
        return originalValues();
      };
      return range;
    };
    const context = await setup(sheet);
    const result = outputJson(context.doPost(event({ secret: 'synthetic-secret', role: 'student',
      action: 'getStudentBootstrap', params: ['0'], subject: { studentId: '0', name: 'Synthetic' } })));
    assert.equal(result.success, false, `${name}/${failOnRead}`);
    assert.deepEqual(result.diagnostic, { stage: 'student_operation', kind: 'service_unavailable' });
    assert.doesNotMatch(JSON.stringify(result), /private-data|Synthetic|synthetic-secret/);
  }
});

test('bootstrap distinguishes missing required sheets from genuinely empty research histories', async () => {
  for (const missing of ['info', 'caffeine', 'sleep']) {
    const sheet = fixture();
    const original = sheet.getSheetByName.bind(sheet);
    sheet.getSheetByName = name => name === missing ? null : original(name);
    const context = await setup(sheet);
    assert.throws(() => context.getStudentBootstrap('0'), /BOOTSTRAP_SHEET_MISSING/, missing);
  }
  const sheet = createMemorySpreadsheet({ info: [Array(11).fill('header')], caffeine: [Array(15).fill('header')], sleep: [Array(19).fill('header')] });
  const context = await setup(sheet);
  const result = context.getStudentBootstrap('0');
  assert.equal(result.weight.success, false);
  assert.deepEqual(Array.from(result.caffeineLogs), []);
  assert.deepEqual(Array.from(result.sleepLogs), []);
  assert.equal(result.stats.labels.length, 7);
  assert.equal(result.sleepSettings.success, true);
});

test('bootstrap propagates sleep-setting read failures while standalone readers retain their fallback', async () => {
  const sheet = fixture();
  const context = await setup(sheet, { PropertiesService: { getScriptProperties() {
    return { getProperty() { throw new Error('Service unavailable'); } };
  } } });
  assert.throws(() => context.getStudentBootstrap('0'), /Service unavailable/);
  assert.equal(context.getSleepSettings().success, false);
  context.getSpreadsheet_ = () => { throw new Error('Service unavailable'); };
  assert.equal(context.getWeightData('0').success, false);
  assert.equal(context.getStats('0').labels.length, 0);
  assert.equal(context.getCaffeineLogs('0').length, 0);
  assert.equal(context.getSleepLogs('0').length, 0);
});
