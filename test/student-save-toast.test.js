import {SleepRecordPolicy} from './support/sleep-policy.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync('index.html', 'utf8');
const source = fs.readFileSync('public/js/student-feedback.js', 'utf8');
function extract(name) {
  const start = html.search(new RegExp(`    (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return html.slice(start, html.indexOf('\n    }', start) + 6);
}
function caffeinePopupFields() {
  const ids = ['caffeineWarningModal', 'warningModalHeader', 'warningEmoji', 'warningUserName',
    'warningIntakeInfo', 'warningAmount', 'warningPercentage', 'warningTitle', 'warningDesc', 'warningInfo', 'warningConfirmBtn'];
  const label = {};
  const fields = Object.fromEntries(ids.map(id => [id, { style: { display: 'none' }, querySelector: () => label, blur() {} }]));
  return fields;
}
function setup() {
  const appended = [], timers = [], cancelled = [];
  function element() {
    return { hidden: true, children: [], attributes: {}, textContent: '', offsetWidth: 320,
      classList: { add() {}, remove() {} },
      setAttribute(k, v) { this.attributes[k] = v; },
      append(...children) { this.children.push(...children); } };
  }
  const document = { createElement: element, body: { appendChild(el) { appended.push(el); } } };
  const context = vm.createContext({SleepRecordPolicy,sleepLogs:[], window: {} });
  vm.runInContext(source, context);
  assert.equal(typeof context.window.StudentFeedback.createSaveToast, 'function');
  const toast = context.window.StudentFeedback.createSaveToast({ document,
    setTimer(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimer(id) { cancelled.push(id); } });
  return { toast, appended, timers, cancelled };
}

test('save toast is accessible, treats message as text and disappears after three seconds', () => {
  const { toast, appended, timers } = setup();
  toast.show('<img src=x onerror=alert(1)>\n서버 전송 대기');
  assert.equal(appended.length, 1);
  const root = appended[0];
  assert.equal(root.attributes.role, 'status');
  assert.equal(root.attributes['aria-live'], 'polite');
  assert.equal(root.children[1].textContent, '<img src=x onerror=alert(1)>\n서버 전송 대기');
  assert.equal(root.hidden, false);
  assert.equal(timers[0].delay, 3000);
  timers[0].callback();
  assert.equal(root.hidden, true);
});

test('consecutive saves reuse one toast and an old timer cannot hide the latest result', () => {
  const { toast, appended, timers, cancelled } = setup();
  toast.show('첫 번째 저장');
  toast.show('두 번째 저장');
  assert.equal(appended.length, 1);
  assert.deepEqual(cancelled, [1]);
  timers[0].callback();
  assert.equal(appended[0].hidden, false);
  assert.equal(appended[0].children[1].textContent, '두 번째 저장');
  toast.dismiss();
  assert.equal(appended[0].hidden, true);
  timers[1].callback();
  assert.equal(appended[0].hidden, true);
});

test('generic save acknowledgements use the toast', () => {
  const notices = [];
  const context = vm.createContext({SleepRecordPolicy,sleepLogs:[], window: { StudentFeedback: { showSaved: x => notices.push(x) } } });
  vm.runInContext(extract('showSaveCompleteModal'), context);
  context.showSaveCompleteModal('설정이 저장됐어요');
  assert.equal(notices[0], '설정이 저장됐어요');
});

test('sleep status remains a popup for both recommended and excessive duration', () => {
  const popups = [], notices = [];
  const context = vm.createContext({SleepRecordPolicy,sleepLogs:[], SLEEP_CFG: {}, setTimeout() {},
    document: { createElement: () => ({}), body: { appendChild: el => popups.push(el) } },
    window: { StudentFeedback: { showSaved: x => notices.push(x) } },
  });
  vm.runInContext(fs.readFileSync('public/js/sleep-comparison-chart.js','utf8'),context);vm.runInContext(extract('showSaveCompleteModal') + '\n' + extract('showSleepCompleteModal'), context);
  context.showSleepCompleteModal('8.0', false, false);
  context.showSleepCompleteModal('12.0', true, true);
  assert.equal(popups.length, 2);
  assert.match(popups[0].innerHTML, /권장 범위/);
  assert.match(popups[0].innerHTML, /8\.0시간/);
  assert.doesNotMatch(popups[0].innerHTML, /전송 대기/);
  assert.match(popups[1].innerHTML, /권장보다 김/);
  assert.match(popups[1].innerHTML, /12\.0시간/);
  assert.match(popups[1].innerHTML, /전송 대기/);
  assert.equal(notices.length, 0);
});

test('caffeine saving does not announce success until confirmed and distinguishes device storage', () => {
  const notices = [];
  const fields = caffeinePopupFields();
  const context = vm.createContext({SleepRecordPolicy,sleepLogs:[], window: {}, caffeineLogs: [], userLimit: 150, user: { name: '테스트' },
    document: { getElementById: id => fields[id] }, setTimeout() {},
    getTodayKST: () => '2026-10-11', getLogDateKST: x => x.slice(0, 10),
    showSaveCompleteModal: x => notices.push(x) });
  vm.runInContext(extract('showCaffeineWarning'), context);
  context.showCaffeineWarning(30, 80, 'pending');
  assert.equal(notices.length, 0);
  assert.equal(fields.caffeineWarningModal.style.display, 'none');
  context.showCaffeineWarning(30, 80, 'confirmed');
  assert.equal(fields.caffeineWarningModal.style.display, 'flex');
  assert.match(fields.warningInfo.innerText, /서버 저장 완료.*80mg/s);
  assert.doesNotMatch(fields.warningInfo.innerText, /전송 대기/);
  context.showCaffeineWarning(30, 110, 'local');
  assert.match(fields.warningInfo.innerText, /전송 대기/);
  assert.match(fields.warningInfo.innerText, /110mg/);
  assert.equal(notices.length, 0, 'health popup must not duplicate a completion toast');
});

for (const [total, stage] of [[0, '1단계'], [84, '2단계'], [150, '3단계'], [180, '4단계'], [300, '5단계']]) {
  test(`confirmed caffeine ${total}mg preserves the ${stage} status popup`, () => {
    const fields = caffeinePopupFields();
    const context = vm.createContext({SleepRecordPolicy,sleepLogs:[], caffeineLogs: [], userLimit: 150, user: { name: '테스트' },
      getTodayKST: () => '2026-10-11', getLogDateKST: x => x.slice(0, 10),
      document: { getElementById: id => fields[id] }, setTimeout() {}, showSaveCompleteModal() {} });
    vm.runInContext(extract('showCaffeineWarning'), context);
    context.showCaffeineWarning(0, total, 'confirmed');
    assert.equal(fields.caffeineWarningModal.style.display, 'flex');
    assert.match(fields.warningTitle.innerText, new RegExp(stage));
  });
}

for (const kind of ['caffeine', 'sleep']) {
  test(`${kind} edit acknowledges device-only changes without claiming server storage`, async () => {
    let onSuccess;
    const notices = [], failures = [];
    let closed = false;
    const fields = {
      ...caffeinePopupFields(),
      editDrinkName: { value: '커피' }, editAmount: { value: '30' },
      editTime: { value: '2026-10-11T12:00' }, editReasonEtc: { value: '' },
      editSleepStart: { value: '2026-10-10T23:00' }, editSleepEnd: { value: '2026-10-11T07:00' },
      editMemo: { value: '' }, editSaveBtn: { disabled: false },
    };
    const runner = { withSuccessHandler(fn) { onSuccess = fn; return this; },
      withFailureHandler() { return this; }, updateCaffeineData() {}, updateSleepData() {} };
    const context = vm.createContext({SleepRecordPolicy,withSleepHistoryReview:cb=>cb(),mergeSleepHistoryAfterSave:async()=>{},sleepLogs:[{id:'local_test'}], editingType: kind, editingId: 'local_test',
      user: { studentId: 'test', name: '테스트' },
      window: { editCondition: '😐', StudentFeedback: { showSaved: x => notices.push(x) } },
      document: { getElementById: id => fields[id], querySelectorAll: () => [],
        createElement: () => ({}), body: { appendChild: el => notices.push(el.innerHTML) } },
      SLEEP_CFG: {}, setTimeout() {},
      caffeineLogs: [{ id: 'local_test', amount: 80, time: '2026-10-11T09:00' }, { id: 'other', amount: 50, time: '2026-10-11T10:00' }], userLimit: 150,
      getTodayKST: () => '2026-10-11', getLogDateKST: x => x.slice(0, 10),
      google: { script: { run: runner } },
      datePartFromDatetime: x => x.slice(0, 10), timePartFromDatetime: x => x.slice(11),
      showInfoModal: (...args) => failures.push(args),
      closeEditModal() { closed = true; }, refreshData() {}, loadCaffeineLogs() {}, loadSleepLogs() {},
    });
    vm.runInContext(fs.readFileSync('public/js/sleep-comparison-chart.js','utf8'),context);vm.runInContext(['setEditSavePending', 'saveEdit', 'showSleepCompleteModal', 'showSaveCompleteModal', 'showCaffeineWarning'].map(extract).join('\n'), context);
    context.saveEdit();
    await onSuccess({ success: true, localSaved: true });
    if (kind === 'caffeine') {
      assert.match(fields.warningInfo.innerText, /전송 대기/);
      assert.match(fields.warningInfo.innerText, /80mg/, 'edited amount replaces the old amount in today total');
      assert.equal(notices.length, 0);
    } else assert.match(notices[0], /전송 대기/);
    assert.equal(closed, true);
    assert.equal(fields.editSaveBtn.disabled, false);
    notices.length = 0; closed = false;
    context.saveEdit();
    await onSuccess({ success: false });
    assert.equal(notices.length, 0);
    assert.equal(closed, false);
    assert.match(failures[0][0], /확인 필요/);
  });
}

for (const copied of [true, false]) {
  test(`clipboard fallback reports ${copied ? 'success' : 'persistent failure'} according to the real copy result`, async () => {
    const notices = [], failures = [];
    let removed = false;
    const context = vm.createContext({SleepRecordPolicy,sleepLogs:[], user: { name: '테스트' }, window: { currentAIAnalysis: '합성 분석' },
      navigator: { clipboard: { writeText: async () => { throw new Error('unavailable'); } } },
      document: { createElement: () => ({ select() {} }), execCommand: () => copied,
        body: { appendChild() {}, removeChild() { removed = true; } } },
      showSaveCompleteModal: message => notices.push(message), showInfoModal: (...args) => failures.push(args) });
    vm.runInContext(extract('copyToClipboard'), context);
    await context.copyToClipboard();
    assert.equal(removed, true);
    assert.equal(notices.length, copied ? 1 : 0);
    assert.equal(failures.length, copied ? 0 : 1);
  });
}

test('new caffeine saving preserves the draft when no successful acknowledgment is received', () => {
  for (const response of [null, { success: false }]) {
    let acknowledge;
    const notices = [], failures = [];
    const fields = { drinkName: { value: '합성 커피' }, customAmount: { value: '30' }, caffeineTime: { value: '2026-10-10T12:00' },
      caffeineReasonEtc: { value: '', classList: { add() {} } }, saveCaffeineBtn: { disabled: false } };
    const runner = { withSuccessHandler(fn) { acknowledge = fn; return this; }, withFailureHandler() { return this; }, saveCaffeineData() {} };
    const context = vm.createContext({SleepRecordPolicy,sleepLogs:[], user: { studentId: 'test', name: '테스트' }, selectedDrink: {}, pendingCaffeineSave: null,
      caffeineLogs: [], confirmedPendingCaffeine: [], getTodayKST: () => '2026-10-11', getLogDateKST: x => x.slice(0, 10),
      document: { getElementById: id => fields[id], querySelectorAll: () => [{ value: '없음' }] },
      google: { script: { run: runner } }, renderCaffeineLogs() {}, applyConfirmedCaffeineSave: () => false,
      loadCaffeineLogs() {}, refreshData() {}, showSaveCompleteModal: message => notices.push(message),
      showInfoModal: (...args) => failures.push(args) });
    vm.runInContext(extract('submitCaffeine'), context);
    context.submitCaffeine(); acknowledge(response);
    assert.equal(fields.drinkName.value, '합성 커피');
    assert.equal(fields.saveCaffeineBtn.disabled, false);
    assert.equal(notices.length, 0);
    assert.equal(failures.length, 1);
  }
});
