import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createTeacherSaveFeedback } from '../public/js/teacher-save-feedback.js';

const html = readFileSync(new URL('../teacher/index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name);
  const next = html.indexOf('\nfunction ', start + 1);
  return html.slice(start, next < 0 ? html.indexOf('</script>', start) : next);
}
function remote() {
  const calls = [];
  const run = new Proxy({}, { get(_, method) {
    if (method !== 'withSuccessHandler' && method !== 'withFailureHandler') throw new Error('missing handlers');
    const call = {};
    const chain = new Proxy({}, { get(_, key) {
      if (key === 'withSuccessHandler') return callback => { call.success = callback; return chain; };
      if (key === 'withFailureHandler') return callback => { call.failure = callback; return chain; };
      return (...args) => { Object.assign(call, { method: key, args }); calls.push(call); };
    } });
    return chain[method];
  } });
  return { calls, google: { script: { run } } };
}
function setup(names, overrides = {}) {
  const server = remote();
  const notices = [];
  const elements = new Map();
  const appended = [];
  const timers = [];
  function element() {
    return { style: {}, textContent: '', innerHTML: '', addEventListener() {}, remove() { this.removed = true; } };
  }
  const ctx = vm.createContext({
    ...server, console: { warn() {} }, window: {},
    showTeacherModal: (...args) => notices.push(args),
    document: {
      getElementById: id => elements.get(id) || null,
      createElement: () => {
        const el = element();
        Object.defineProperty(el, 'innerHTML', {
          set(value) { this.textContent = String(value).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"'); },
          get() { return ''; },
        });
        return el;
      },
      body: { appendChild: el => { appended.push(el); elements.set(el.id, el); } },
    },
    localStorage: { setItem() {} },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
    escapeHtml: value => String(value), sanitizeRichHtml: value => value,
    ...overrides,
  });
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return { ctx, notices, elements, appended, timers, calls: server.calls, element };
}
const badge = { id: 'badge_a', name: '기록', image: '🏅', bg: '#fff', color: '#000' };
function approvalSetup(names, overrides = {}) {
  return setup(names, {
    manualAwards: {}, pendingBadges: [{ studentId: '2101', badgeId: 'badge_a' }], pendingSelected: new Set(),
    saveManualAwards() {}, savePendingBadges() {}, renderPendingBadges() {}, renderAwardsTab() {}, updateStudentGrid() {},
    ...overrides,
  });
}

test('teacher successes use the existing toast with plain text and clear the old progress popup', () => {
  const states = [];
  const s = setup(['showTeacherModal'], { window: { teacherSaveFeedback: { show: (...args) => states.push(args) } } });
  const old = s.element(); s.elements.set('teacherAlertModal', old);
  s.ctx.showTeacherModal('✅', '완료', '<strong>홍길동 &amp; 친구</strong><br>저장했습니다.', 'success');
  assert.equal(old.removed, true);
  assert.equal(s.appended.length, 0);
  assert.deepEqual(states, [['success', '홍길동 & 친구 저장했습니다.']]);
});

test('teacher warnings and errors remain persistent popups and confirmation still requires input', () => {
  const s = setup(['showTeacherModal']);
  for (const type of ['warning', 'warn', 'error', 'info']) {
    s.ctx.showTeacherModal('⚠️', '확인', '읽어 주세요', type);
    assert.equal(s.appended.at(-1).id, 'teacherAlertModal');
  }
  assert.equal(s.timers.length, 0);
  s.elements.set('_tmCancelBtn', {}); s.elements.set('_tmOkBtn', {});
  let confirmed = false;
  s.ctx.showTeacherModal('🗑️', '삭제', '삭제할까요?', 'confirm', () => { confirmed = true; });
  assert.equal(confirmed, false);
  s.elements.get('_tmOkBtn').onclick();
  assert.equal(confirmed, true);
});

test('single badge approval waits for server acknowledgement and preserves retry flags on rejection', () => {
  for (const success of [true, false]) {
    const s = approvalSetup(['_doApprovePendingBadge']);
    s.ctx._doApprovePendingBadge('2101', badge.id, badge, '홍길동');
    assert.equal(s.notices.some(n => n[3] === 'success'), false);
    assert.equal(s.ctx.manualAwards['2101'][0]._pendingSync, true);
    s.calls[0].success({ success, error: 'rejected' });
    assert.equal(s.notices.at(-1)[3], success ? 'success' : 'warning');
    assert.equal(s.ctx.manualAwards['2101'][0]._pendingSync, success ? undefined : true);
  }
});

test('single badge approval keeps network and synchronous connection failures visible', () => {
  const s = approvalSetup(['_doApprovePendingBadge']);
  s.ctx._doApprovePendingBadge('2101', badge.id, badge, '홍길동');
  s.calls[0].failure(new Error('offline'));
  assert.equal(s.notices.at(-1)[3], 'warning');
  assert.equal(s.ctx.manualAwards['2101'][0]._pendingSync, true);
  const broken = approvalSetup(['_doApprovePendingBadge'], { google: { script: { get run() { throw new Error('offline'); } } } });
  broken.ctx._doApprovePendingBadge('2101', badge.id, badge, '홍길동');
  assert.equal(broken.notices.at(-1)[3], 'warning');
});

test('bulk badge approval reports one final result after every group, keeping partial failures pending', async () => {
  for (const success of [true, false]) {
    const s = approvalSetup(['_doBulkApprovePending']);
    const saving = s.ctx._doBulkApprovePending([
      { studentId: '2101', badgeId: badge.id, badge },
      { studentId: '2102', badgeId: 'badge_b', badge: { ...badge, id: 'badge_b' } },
    ]);
    assert.equal(s.notices.some(n => n[3] === 'success'), false);
    s.calls[0].success({ success: true });
    assert.equal(s.notices.some(n => n[3] === 'success'), false);
    s.calls[1].success({ success, error: 'rejected' });
    await saving;
    assert.equal(s.notices.filter(n => n[3] === 'success').length, success ? 1 : 0);
    assert.equal(s.notices.at(-1)[3], success ? 'success' : 'warning');
    assert.equal(s.ctx.manualAwards['2102'][0]._pendingSync, success ? undefined : true);
  }
});

test('bulk approval network or synchronous connection failure cannot be replaced by another group success', async () => {
  for (const kind of ['network', 'sync']) {
    const s = approvalSetup(['_doBulkApprovePending'], kind === 'sync'
      ? { google: { script: { get run() { throw new Error('offline'); } } } } : {});
    const saving = s.ctx._doBulkApprovePending([
      { studentId: '2101', badgeId: badge.id, badge },
      { studentId: '2102', badgeId: 'badge_b', badge: { ...badge, id: 'badge_b' } },
    ]);
    if (kind === 'network') {
      s.calls[0].failure(new Error('offline'));
      s.calls[1].success({ success: true });
    }
    await saving;
    assert.equal(s.notices.length, 1);
    assert.equal(s.notices[0][3], 'warning');
    assert.equal(s.ctx.manualAwards['2101'][0]._pendingSync, true);
  }
});

test('badge approval retains retry flags if completion synchronization throws', async () => {
  for (const bulk of [false, true]) {
    let writes = 0;
    const s = approvalSetup([bulk ? '_doBulkApprovePending' : '_doApprovePendingBadge'], {
      saveManualAwards() { if (++writes > 1) throw new Error('storage unavailable'); },
    });
    const saving = bulk
      ? s.ctx._doBulkApprovePending([{ studentId: '2101', badgeId: badge.id, badge }])
      : s.ctx._doApprovePendingBadge('2101', badge.id, badge, '홍길동');
    s.calls[0].success({ success: true });
    await saving;
    assert.equal(s.notices.at(-1)[3], 'warning');
    assert.equal(s.ctx.manualAwards['2101'][0]._pendingSync, true);
  }
});

test('standalone award settings report confirmed success once and keep failures in a popup', async () => {
  for (const success of [true, false]) {
    const s = setup(['saveAwardSettings'], { awardSettings: [], syncAwardEditorToSettings() {} });
    const saving = s.ctx.saveAwardSettings();
    assert.equal(s.notices.length, 0);
    s.calls[0].success({ success });
    assert.equal(await saving, success);
    assert.equal(s.notices.length, 1);
    assert.equal(s.notices[0][3], success ? 'success' : 'warning');
    assert.equal(s.timers.length, 0);
  }
});

test('challenge configuration false acknowledgement and network failure stay visible without expiry', () => {
  for (const kind of ['false', 'network', 'success']) {
    const s = setup(['saveChallengeBadgeSettings'], {
      journeyConfig: {}, S: {}, BadgeJourney: { DEFAULT_CONFIG: { badges: [] } },
      readJourneySchedules: () => ({}), saveChallengeBadges() {}, rebuildAwardDropdown() {}, renderChallengeBadgeList() {}, renderJourneyStatus() {},
    });
    const status = s.element(); s.elements.set('challengeSaveStatus', status);
    s.ctx.saveChallengeBadgeSettings();
    if (kind === 'network') s.calls[0].failure(new Error('offline'));
    else s.calls[0].success({ success: kind === 'success' });
    if (kind === 'success') assert.equal(s.notices.at(-1)?.[3], 'success');
    else assert.match(status.textContent, /실패/);
    assert.equal(s.timers.length, 0);
  }
});

test('general settings wait for both server writes and cannot claim success on partial failure', async () => {
  for (const success of [true, false]) {
    const states = [];
    const feedback = createTeacherSaveFeedback({ render: state => states.push(state), setTimer: () => 1 });
    const s = setup(['saveSettings', 'saveSleepSettingsToGAS', 'saveAwardSettings'], {
      window: { teacherSaveFeedback: feedback }, S: {}, awardSettings: [], studentsData: [],
      readCafSettings: () => ({ cafWarn: 56, cafOver: 100 }), syncAwardEditorToSettings() {}, updateCafPreview() {}, updateSleepPreview() {},
    });
    for (const id of ['setting_sleepSevere', 'setting_sleepWarn', 'setting_sleepGood', 'setting_sleepMax', 'setting_aiMinCaf', 'setting_aiMinSleep', 'sleepWarningDetail']) s.elements.set(id, { value: '8' });
    const saving = s.ctx.saveSettings();
    const settled = Promise.resolve(saving).catch(() => {});
    await Promise.resolve();
    assert.equal(states.at(-1).type, 'loading');
    s.calls.find(c => c.method === 'saveSleepSettings').success({ success: true });
    await Promise.resolve();
    assert.equal(states.at(-1).type, 'loading');
    s.calls.find(c => c.method === 'saveAwardSettingsData').success({ success, error: 'rejected' });
    await settled;
    assert.equal(states.at(-1).type, success ? 'success' : 'error');
    assert.equal(states.filter(state => state.type === 'success').length, success ? 1 : 0);
  }
});

test('confirmed message deletion and visibility changes acknowledge only successful writes', () => {
  for (const hidden of [true, false]) {
    const s = setup(['saveStudentVisibility'], {
      visibilitySaving: false, visibilityRevision: 0, hiddenStudentIds: new Set(),
      updateVisibilityControls() {}, clearTeacherViewCache() {}, refreshAnalysisVisibility() {},
    });
    s.ctx.saveStudentVisibility(['2101'], hidden);
    assert.equal(s.notices.length, 0);
    s.calls[0].success({ success: true, hiddenStudentIds: hidden ? ['2101'] : [] });
    assert.equal(s.notices.at(-1)?.[3], 'success');
  }
  for (const bulk of [false, true]) {
    const key = 'a'.repeat(64);
    const s = setup([bulk ? 'confirmBulkDeleteSentMsg' : 'confirmDeleteSentMsg'], {
      window: { _sentMsgSelected: new Set([2]), _sentMsgTargets: new Map([[2, { rowIndex: 2, messageKey: key }]]) },
      loadSentMessages() {},
    });
    if (bulk) s.ctx.confirmBulkDeleteSentMsg();
    else s.ctx.confirmDeleteSentMsg(2, '제목', key);
    assert.equal(s.notices.at(-1)[3], 'confirm');
    s.notices.at(-1)[4]();
    s.calls[0].success({ success: true });
    assert.equal(s.notices.at(-1)[3], 'success');
  }
});

test('pending badge retries reach the server and clear flags only after acknowledgement', () => {
  for (const success of [true, false]) {
    const award = { badgeId: 'badge_a', name: '기록', grantedAt: '2026-10-11', _pendingSync: true };
    const s = approvalSetup(['retryPendingSyncs'], { manualAwards: { '2101': [award] }, console: { log() {}, warn() {} } });
    s.ctx.retryPendingSyncs();
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].method, 'grantTeacherAwards');
    assert.equal(s.calls[0].args[0].grantedAt, '2026-10-11');
    assert.equal(award._pendingSync, true);
    s.calls[0].success({ success });
    assert.equal(award._pendingSync, success ? undefined : true);
  }
});
