import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  return start < 0 ? '' : html.slice(start, html.indexOf('\n    }', start) + 6);
}

// Exercise the real open/save/callback paths; only DOM and remote I/O are substituted.
function form() {
  const fields = Object.fromEntries(Object.entries({
    drinkName: '작성 중인 커피', customAmount: '150', caffeineTime: '2026-10-19T10:00',
    caffeineReasonEtc: '기존 메모', zeroCaffeineTime: '',
  }).map(([id, value]) => [id, { value, disabled: false, classList: { add() {} }, reportValidity() { return Boolean(this.value); } }]));
  fields.saveCaffeineBtn = { disabled: false, innerText: '카페인 기록 완료' };
  fields.zeroCaffeineSaveBtn = { disabled: false, innerText: '기록 저장' };
  fields.zeroCaffeineCancelBtn = { disabled: false };
  fields.zeroCaffeineError = { textContent: '', hidden: true };
  fields.zeroCaffeineModal = {
    open: false, opens: 0, showModal() { this.open = true; this.opens++; }, close() { this.open = false; },
  };
  const reasons = [{ value: '공부', checked: true }], symptoms = [{ value: '두근거림', checked: true }];
  let success, failure;
  const requests = [], notices = [], selections = [];
  const runner = {
    withSuccessHandler(fn) { success = fn; return this; },
    withFailureHandler(fn) { failure = fn; return this; },
    saveCaffeineData(payload) { requests.push(JSON.parse(JSON.stringify(payload))); },
  };
  class FixedDate extends Date {
    static now() { return Date.parse('2026-10-20T04:55:00Z'); }
  }
  const context = vm.createContext({
    Date: FixedDate, user: { studentId: 'test', name: '합성 검증' },
    selectedDrink: { drink: '작성 중인 커피', mg: 150, company: '기존 업체' },
    caffeineLogs: [], confirmedPendingCaffeine: [], pendingCaffeineSave: null,
    document: { getElementById: id => fields[id] || null,
      querySelectorAll: query => query.includes('Reason') ? reasons : symptoms },
    google: { script: { run: runner } }, console: { error() {} },
    setDrink: (...args) => selections.push(args), renderCaffeineLogs() {},
    getLogDateKST: value => value.slice(0, 10), getTodayKST: () => '2026-10-20',
    applyConfirmedCaffeineSave: () => true, loadCaffeineLogs() {}, refreshData() {},
    showCaffeineWarning: (...args) => notices.push(args), closeCaffeineWarning() {},
    showInfoModal: (...args) => notices.push(args), showSaveCompleteModal: message => notices.push(message),
  });
  vm.runInContext(['setDrinkZero', 'closeZeroCaffeineModal', 'setZeroCaffeinePending',
    'submitZeroCaffeine', 'submitCaffeine'].map(extract).join('\n'), context);
  return { fields, requests, notices, selections, reasons, symptoms, context,
    open: () => context.setDrinkZero(), save: () => context.submitZeroCaffeine(),
    succeed: value => success(value), fail: () => failure(new Error('offline')) };
}

test('zero intake opens synchronously without a request or changing the existing drink draft', () => {
  const f = form();
  f.open();
  assert.equal(f.fields.zeroCaffeineModal.open, true);
  assert.equal(f.fields.zeroCaffeineTime.value, '2026-10-20T13:55');
  assert.equal(f.requests.length, 0);
  assert.equal(f.selections.length, 0);
  assert.equal(f.fields.drinkName.value, '작성 중인 커피');
  f.fields.zeroCaffeineTime.value = '2026-10-18T12:30';
  f.open();
  assert.equal(f.fields.zeroCaffeineModal.opens, 1);
  assert.equal(f.fields.zeroCaffeineTime.value, '2026-10-18T12:30');
});

test('canceling zero intake leaves the full drink draft intact and sends nothing', () => {
  const f = form(); f.open(); f.context.closeZeroCaffeineModal();
  assert.equal(f.fields.zeroCaffeineModal.open, false);
  assert.equal(f.fields.drinkName.value, '작성 중인 커피');
  assert.equal(f.fields.customAmount.value, '150');
  assert.equal(f.fields.caffeineTime.value, '2026-10-19T10:00');
  assert.equal(f.reasons[0].checked, true);
  assert.equal(f.symptoms[0].checked, true);
  assert.equal(f.requests.length, 0);
});

test('zero intake saves the chosen time with no stale reason, symptom or company, once while pending', () => {
  const f = form(); f.open();
  f.fields.zeroCaffeineTime.value = '2026-10-18T12:30';
  f.save(); f.save(); f.context.submitCaffeine();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0], {
    studentId: 'test', name: '합성 검증', drink: '카페인 섭취 안 함',
    company: '', foodName: '', mg: 0, time: '2026-10-18T12:30', reason: '', symptom: '',
    id: 1792472100000,
  });
  assert.equal(f.fields.zeroCaffeineSaveBtn.disabled, true);
  assert.equal(f.fields.zeroCaffeineTime.disabled, true);
  assert.equal(f.fields.zeroCaffeineCancelBtn.disabled, true);
  f.context.closeZeroCaffeineModal();
  assert.equal(f.fields.zeroCaffeineModal.open, true);
  assert.equal(f.notices.length, 0, 'no overlapping pending popup');
});

test('empty zero intake time does not send a request', () => {
  const f = form(); f.open(); f.fields.zeroCaffeineTime.value = ''; f.save();
  assert.equal(f.requests.length, 0);
  assert.equal(f.fields.zeroCaffeineSaveBtn.disabled, false);
});

for (const response of [null, { success: false }, 'network failure']) {
  test(`zero intake retains the time and allows retry after ${JSON.stringify(response)}`, () => {
    const f = form(); f.open(); f.fields.zeroCaffeineTime.value = '2026-10-18T12:30'; f.save();
    if (response === 'network failure') f.fail(); else f.succeed(response);
    assert.equal(f.fields.zeroCaffeineModal.open, true);
    assert.equal(f.fields.zeroCaffeineTime.value, '2026-10-18T12:30');
    assert.equal(f.fields.zeroCaffeineSaveBtn.disabled, false);
    assert.equal(f.fields.saveCaffeineBtn.disabled, false);
    assert.equal(f.fields.zeroCaffeineError.hidden, false);
    assert.ok(f.fields.zeroCaffeineError.textContent);
    assert.equal(f.notices.length, 0, 'errors stay inside the dialog');
    f.save(); assert.equal(f.requests.length, 2);
  });
}

test('confirmed zero intake closes the dialog and preserves the separate drink draft', () => {
  const f = form(); f.open(); f.save(); f.succeed({ success: true });
  assert.equal(f.fields.zeroCaffeineModal.open, false);
  assert.equal(f.fields.drinkName.value, '작성 중인 커피');
  assert.equal(f.fields.customAmount.value, '150');
  assert.equal(f.reasons[0].checked, true);
  assert.equal(f.symptoms[0].checked, true);
  assert.equal(f.notices.length, 1);
  assert.equal(f.notices[0][2], 'confirmed');
});
