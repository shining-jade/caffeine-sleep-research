import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  return html.slice(start, html.indexOf('\n    }', start) + 6);
}

// Keep the validation and save paths real; replace only UI choices and the remote service.
function form({ edit = false, start = '2026-10-10T23:00', end = '2026-10-11T11:00', duplicate = false } = {}) {
  const fields = Object.fromEntries(Object.entries({
    sleepStart: start, sleepEnd: end, sleepDate: '', sleepMemo: '입력 유지',
    editSleepStart: start, editSleepEnd: end, editMemo: '수정 내용',
  }).map(([id, value]) => [id, { value }]));
  fields.saveSleepBtn = { disabled: false, innerText: '수면 기록 완료' };
  fields.editSaveBtn = { disabled: false, innerText: '저장하기' };
  const requests = [], longPrompts = [], overwritePrompts = [], notices = [];
  let success;
  const runner = {
    withSuccessHandler(fn) { success = fn; return this; }, withFailureHandler() { return this; },
    saveSleepData(payload) { requests.push({ action: 'save', payload: JSON.parse(JSON.stringify(payload)) }); },
    updateSleepData(payload) { requests.push({ action: 'edit', payload: JSON.parse(JSON.stringify(payload)) }); },
  };
  const context = vm.createContext({
    user: { studentId: 'test', name: '합성 검증' }, editingType: 'sleep', editingId: 'sleep-1',
    selectedCondition: { emoji: '😊', score: 5 },
    sleepChoices: { smartphone: '안 함', activity: '30분', latency: '15분 이내', awakenings: '없음', daytime: '없음' },
    window: { editCondition: '😊', editSleepChoices: { smartphone: '안 함' } },
    sleepLogs: duplicate ? [{ id: 'old', date: '2026-10-10', hours: 8, start: '23:00', end: '07:00', condition: '😐', memo: '' }] : [],
    document: { getElementById: id => fields[id] || null, querySelectorAll: () => [] },
    console: { log() {}, warn() {} }, google: { script: { run: runner } },
    showInfoModal: (...args) => notices.push(args),
    showSleepCompleteModal: () => notices.push(['success']), resetSleepChoices() {}, loadSleepLogs() {}, refreshData() {},
    showLongSleepConfirm: (start, end, confirm) => longPrompts.push({ start, end, confirm }),
    showOverwriteConfirm: (message, confirm) => overwritePrompts.push({ message, confirm }),
  });
  vm.runInContext(['datePartFromDatetime', 'timePartFromDatetime', 'formatSleepDateTimeRange',
    'getMissingSleepFields', 'proceedSaveSleep', 'submitSleep', 'setEditSavePending', 'saveEdit'].map(extract).join('\n'), context);
  return { fields, requests, longPrompts, overwritePrompts, notices, context,
    submit: () => edit ? context.saveEdit() : context.submitSleep(), acknowledge: value => success(value) };
}

for (const response of [null, { success: false }]) {
  test(`new sleep preserves the draft without a success popup for ${JSON.stringify(response)} acknowledgment`, () => {
    const f = form({ end: '2026-10-11T07:00' });
    f.submit(); f.acknowledge(response);
    assert.equal(f.fields.sleepStart.value, '2026-10-10T23:00');
    assert.equal(f.fields.sleepMemo.value, '입력 유지');
    assert.equal(f.fields.saveSleepBtn.disabled, false);
    assert.match(f.notices[0][0], /확인/);
    assert.ok(f.notices.every(notice => notice[0] !== 'success'));
  });
}

for (const edit of [false, true]) {
  const name = edit ? 'editing sleep' : 'new sleep';
  test(`${name}: 11h59m saves without a long-sleep warning despite display rounding`, () => {
    const f = form({ edit, end: '2026-10-11T10:59' });
    f.submit();
    assert.equal(f.longPrompts.length, 0);
    assert.equal(f.requests.length, 1);
  });

  test(`${name}: exactly 12 hours waits for explicit confirmation before writing`, () => {
    const f = form({ edit });
    f.submit();
    assert.equal(f.requests.length, 0);
    assert.equal(f.longPrompts.length, 1);
    assert.equal(f.fields[edit ? 'editSaveBtn' : 'saveSleepBtn'].disabled, false);
    f.longPrompts[0].confirm();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].payload.hours, 12);
    assert.equal(f.requests[0].payload.date, '2026-10-10');
    assert.equal(f.requests[0].payload.wakeDate, '2026-10-11');
    assert.equal(f.requests[0].payload.sleepTime, '23:00');
    assert.equal(f.requests[0].payload.wakeTime, '11:00');
    assert.equal(f.requests[0].payload.memo, edit ? '수정 내용' : '입력 유지');
  });

  test(`${name}: a mistaken previous-day bedtime prompts with both full dates`, () => {
    const f = form({ edit, start: '2026-10-10T01:00', end: '2026-10-11T07:00' });
    f.submit();
    assert.equal(f.requests.length, 0);
    assert.equal(f.longPrompts[0].start, '2026-10-10T01:00');
    assert.equal(f.longPrompts[0].end, '2026-10-11T07:00');
    f.longPrompts[0].confirm();
    assert.equal(f.requests[0].payload.hours, 30);
  });

  test(`${name}: returning to correct the date preserves inputs and does not write`, () => {
    const f = form({ edit, start: '2026-10-10T01:00', end: '2026-10-11T07:00' });
    f.submit();
    assert.equal(f.longPrompts.length, 1);
    assert.equal(f.requests.length, 0);
    assert.equal(f.fields[edit ? 'editSleepStart' : 'sleepStart'].value, '2026-10-10T01:00');
    assert.equal(f.fields[edit ? 'editMemo' : 'sleepMemo'].value, edit ? '수정 내용' : '입력 유지');
    f.fields[edit ? 'editSleepStart' : 'sleepStart'].value = '2026-10-11T01:00';
    f.submit();
    assert.equal(f.longPrompts.length, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].payload.hours, 6);
    assert.equal(f.requests[0].payload.date, '2026-10-11');
  });

  test(`${name}: invalid time ordering still stops at input validation`, () => {
    const f = form({ edit, end: '2026-10-10T07:00' });
    f.submit();
    assert.equal(f.notices.length, 1);
    assert.equal(f.longPrompts.length, 0);
    assert.equal(f.requests.length, 0);
  });
}

test('a long duplicate sleep requires date confirmation and then overwrite confirmation', () => {
  const f = form({ duplicate: true });
  f.submit();
  assert.equal(f.longPrompts.length, 1);
  assert.equal(f.overwritePrompts.length, 0);
  assert.equal(f.requests.length, 0);
  f.longPrompts[0].confirm();
  assert.equal(f.overwritePrompts.length, 1);
  assert.equal(f.requests.length, 0);
  f.overwritePrompts[0].confirm();
  assert.equal(f.requests.length, 1);
});
