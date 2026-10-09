import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  return start < 0 ? '' : html.slice(start, html.indexOf('\n    }', start) + 6);
}
function goals(initial = false, target = '150') {
  const fields = {
    userWeight: { value: '68' }, setupWeight: { value: '68' },
    targetCafInput: { value: target }, setupTargetCaf: { value: target },
    targetBedtimeInput: { value: '23:00' }, setupBedtime: { value: '23:00' },
    targetWakeTimeInput: { value: '07:00' }, setupWakeTime: { value: '07:00' },
    targetSleepDisplay: { textContent: '8.0' }, setupSleepHours: { textContent: '8.0' },
    limitDisplay: {}, initialSetupModal: { remove() { this.removed = true; } },
  };
  const requests = [], notices = [], completed = [];
  let success, failure;
  const runner = {
    withSuccessHandler(fn) { success = fn; return this; },
    withFailureHandler(fn) { failure = fn; return this; },
    saveInitialSetup(payload) { requests.push(JSON.parse(JSON.stringify(payload))); },
  };
  const c = vm.createContext({ window: {}, lastDashboardData: null, document: { getElementById: id => fields[id] || null },
    user: { studentId: '0', name: '테스트' }, userWeight: 55, userLimit: 137.5,
    _goalSavePending: false, _setupAgeGroup: 'teen', SLEEP_CFG: { ageGroup: 'teen' },
    google: { script: { run: runner } }, changeSettingsAgeGroup() {},
    refreshData() {}, showWeightSetupModal() { assert.fail('unexpected setup'); },
    showInfoModal: (...args) => notices.push(args), showSaveCompleteModal: x => completed.push(x),
  });
  vm.runInContext(['calculateGoalSleepHours', 'readGoalSettings', 'saveGoalSettings',
    'updateTargetSleepDisplay', 'updateLimitDisplay', 'applyWeightData', 'saveInitialSetup', 'saveAllGoals'].map(extract).join('\n'), c);
  return { c, fields, requests, notices, completed,
    save: () => initial ? c.saveInitialSetup() : c.saveAllGoals(),
    success: result => success(result), fail: () => failure(new Error('DEVICE_STORAGE_FAILED')) };
}

test('loading a custom caffeine goal preserves its dashboard limit separately from the weight hint', () => {
  const x = goals();
  x.c.applyWeightData({ success: true, weight: 68, targetCaf: 150 });
  assert.equal(x.c.userLimit, 150);
  assert.equal(x.fields.limitDisplay.innerText, 170);
});

test('weight preview does not change the saved caffeine assessment threshold', () => {
  const x = goals(); x.c.userLimit = 150; x.fields.userWeight.value = '75';
  x.c.updateLimitDisplay();
  assert.equal(x.c.userLimit, 150);
  assert.equal(x.fields.limitDisplay.innerText, '187.5');
});

for (const initial of [false, true]) {
  test(`${initial ? 'initial' : 'settings'} goals reject zero, out of range and noninteger targets without a write`, () => {
    for (const target of ['0', '-1', '1001', '1.5', 'Infinity', '1e309']) {
      const x = goals(initial, target); x.save();
      assert.equal(x.requests.length, 0, target);
      assert.equal(x.notices.length, 1, target);
    }
  });
  test(`${initial ? 'initial' : 'settings'} goals apply only after durable save and ignore duplicate clicks`, () => {
    const x = goals(initial); x.save(); x.save();
    assert.equal(x.requests.length, 1);
    assert.equal(x.c.userWeight, 55); assert.equal(x.c.userLimit, 137.5);
    assert.equal(x.fields.initialSetupModal.removed, undefined);
    x.success({ success: true, localSaved: true });
    assert.equal(x.c.userWeight, 68); assert.equal(x.c.userLimit, 150);
    assert.equal(x.completed.length, 1);
    if (initial) assert.equal(x.fields.initialSetupModal.removed, true);
  });
  test(`${initial ? 'initial' : 'settings'} device save failure keeps the applied profile and permits retry`, () => {
    const x = goals(initial); x.save(); x.fail();
    assert.equal(x.c.userWeight, 55); assert.equal(x.c.userLimit, 137.5);
    assert.equal(x.fields.userWeight.value, '68');
    assert.equal(x.fields.initialSetupModal.removed, undefined);
    assert.equal(x.completed.length, 0);
    x.save(); assert.equal(x.requests.length, 2);
  });
}

test('an unconfirmed goals response cannot apply settings or claim completion', () => {
  const x = goals(); x.save(); x.success({ success: false });
  assert.equal(x.c.userWeight, 55); assert.equal(x.c.userLimit, 137.5);
  assert.equal(x.completed.length, 0); assert.equal(x.notices.length, 1);
});

test('an empty goal uses weight fallback and sleep hours are derived from the actual time inputs', () => {
  const x = goals(false, ''); x.fields.targetSleepDisplay.textContent = '99';
  x.fields.targetBedtimeInput.value = '00:30'; x.fields.targetWakeTimeInput.value = '08:00';
  x.save(); assert.equal(x.requests[0].targetCaf, 170); assert.equal(x.requests[0].targetSleepHours, 7.5);
});

test('new caffeine records reject negative fractions before integer conversion', () => {
  for (const amount of ['', '-0.5', '-1', 'Infinity', '1e309']) {
    const requests = [], notices = [];
    const fields = { drinkName: { value: '합성 음료' }, customAmount: { value: amount },
      caffeineTime: { value: '2026-10-09T12:00' }, caffeineReasonEtc: { value: '' } };
    const runner = { withSuccessHandler() { return this; }, withFailureHandler() { return this; }, saveCaffeineData(x) { requests.push(x); } };
    const c = vm.createContext({ document: { getElementById: id => fields[id], querySelectorAll: () => [] },
      user: { studentId: '0', name: '테스트' }, selectedDrink: {}, caffeineLogs: [], confirmedPendingCaffeine: [],
      google: { script: { run: runner } }, renderCaffeineLogs() {},
      getLogDateKST: x => x.slice(0, 10), getTodayKST: () => '2026-10-09', showCaffeineWarning() {},
      showInfoModal: (...args) => notices.push(args) });
    vm.runInContext(extract('submitCaffeine') + '\nsubmitCaffeine();', c);
    assert.equal(requests.length, 0, amount); assert.equal(notices.length, 1, amount);
  }
});

test('sleep overwrite confirmation keeps memo markup as literal text', () => {
  const elements = {};
  const c = vm.createContext({ window: {}, document: { getElementById: id => elements[id] || null,
    createElement: () => ({}), body: { appendChild(el) { elements[el.id] = el; elements.overwriteConfirmBtn = {}; } } } });
  vm.runInContext(fs.readFileSync(new URL('../public/js/safe-render.js', import.meta.url), 'utf8') +
    '\nconst escapeHtml = window.safeRender.escapeHtml;\n' + extract('showOverwriteConfirm'), c);
  c.showOverwriteConfirm('메모: <em data-audit="memo">안내</em> & "문자"', () => {});
  const output = elements.overwriteConfirmModal.innerHTML;
  assert.ok(output.includes('메모: &lt;em data-audit=&quot;memo&quot;&gt;안내&lt;/em&gt; &amp; &quot;문자&quot;'));
  assert.ok(!output.includes('<em data-audit='));
});
