import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('teacher/index.html', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const end = source.indexOf('\nfunction ', start + 9);
  return source.slice(start, end < 0 ? undefined : end);
}
function fixture() {
  const fields = {}, requests = [];
  const field = id => fields[id] ||= {
    style: {}, innerHTML: '', textContent: '', value: '', contentEditable: 'false',
    classList: {add() {}, remove() {}, toggle() {}}, getContext() {return {};}
  };
  field('studentDateFilter').value = '2026-10-09';
  const runner = {withSuccessHandler(fn) {this.success = fn; return this;},
    withFailureHandler(fn) {this.failure = fn; return this;}};
  for (const action of ['getAIReport', 'handleAIReportForTeacher', 'saveAIReport']) runner[action] = function (...args) {
    requests.push({action, args, success: this.success, failure: this.failure});
  };
  const c = vm.createContext({
    document: {getElementById: field, createElement: () => ({innerHTML: '', querySelectorAll: () => [], get textContent() {return this.innerHTML;}})}, window: {}, google: {script: {run: runner}},
    studentsData: [{학번: 'A', 이름: '학생A'}, {학번: 'B', 이름: '학생B'}],
    infoData: [], caffeineData: [], sleepData: [], charts: {}, today: '2026-10-09',
    currentStudentId: '', studentPeriodMode: '7', modalPeriodMode: '7',
    aiViewGeneration: 0, aiViewKey: '', aiReportContextKey: '',
    getPeriodLabel: dates => dates.join(' ~ '),
    getLimit: () => 170, getTargetCafText: () => '150mg', getTargetSleepText: () => '8h',
    getTargetCafLimit: () => 150, getTargetSleepHours: () => 8,
    avgCafForDates: () => 52, avgSleepForDates: () => 12, hasCafRecordOnDates: () => false,
    getCafStatusInfo: () => ({text: '안전'}), getSleepStatusInfo: () => ({text: '수면 과다'}), getCafBarColor: () => '#aaa',
    renderAwardChips: () => '', findSleepForLifeDate: () => null,
    DRINK_CHART_COLORS: [], DRINK_CATEGORIES: [],
    getTieAwareSummary: () => ({value: '기록 없음', sub: '-'}), setPatternSummary() {},
    sortByOrder: a => a, sortCountKeys: () => [],
    Chart: function () {this.destroy = () => {};},
    S: {aiMinCaf: 3, aiMinSleep: 3}, countCafDays: () => 3, countSleepDays: () => 3,
    getCafThresholds: () => ({over: 100}), sanitizeRichHtml: s => s, formatAIReportHTML: s => s,
    generateFallbackAnalysis: () => '기본 분석 내용'.repeat(15)
  });
  vm.runInContext([
    'getLastNDates', 'getPeriodN', 'getModalDates', 'getSleepChartMax', 'compareSleepRecordsDesc',
    'getAIContextKey', 'isCurrentAIRequest', 'resetAIReportContext',
    'openStudentModal', 'closeModal', 'refreshModalData', 'setModalPeriod',
    'showAITools', 'loadSavedAIReport', 'requestAIAnalysis', 'saveAIEdit'
  ].map(extract).join('\n'), c);
  return {c, fields, field, requests};
}
const saved = text => ({success: true, content: text.repeat(10), savedAt: '검증'});
const completed = text => ({success: true, analysis: text.repeat(20), source: 'AI_Teacher'});

test('late saved analysis for A cannot overwrite the B modal', () => {
  const {c, field, requests} = fixture();
  c.openStudentModal('A');
  const old = requests.at(-1);
  c.openStudentModal('B');
  requests.at(-1).success(saved('학생B의 현재 분석'));
  old.success(saved('학생A의 이전 분석'));
  assert.match(field('aiContent').innerHTML, /학생B/);
  assert.doesNotMatch(field('aiContent').innerHTML, /학생A/);
});

test('period change clears old analysis and loads the selected period', () => {
  const {c, field, requests} = fixture();
  c.openStudentModal('A');
  const old = requests.at(-1);
  old.success(saved('7일 분석'));
  c.setModalPeriod('14');
  assert.equal(field('aiStatusBadge').textContent, '(분석 전)');
  assert.equal(requests.at(-1).args[1], '2026-09-26');
  old.success(saved('늦게 도착한 7일 분석'));
  assert.doesNotMatch(field('aiContent').innerHTML, /7일 분석/);
  requests.at(-1).success(saved('14일 분석'));
  assert.match(field('aiContent').innerHTML, /14일 분석/);
});

test('late completed analysis cannot overwrite a different student', async () => {
  const {c, field, requests} = fixture();
  c.openStudentModal('A');
  await c.requestAIAnalysis();
  const old = requests.at(-1);
  c.openStudentModal('B');
  old.success(completed('학생A 완료 분석'));
  assert.doesNotMatch(field('aiContent').innerHTML, /학생A/);
  old.failure(new Error('late failure'));
  assert.doesNotMatch(field('aiContent').innerHTML, /기본 분석 내용/);
  assert.equal(field('aiBtn').disabled, false);
});

test('late saved response cannot overwrite an analysis just requested', async () => {
  const {c, field, requests} = fixture();
  c.openStudentModal('A');
  const old = requests.at(-1);
  await c.requestAIAnalysis();
  old.success(saved('오래된 저장 분석'));
  assert.equal(field('aiStatusBadge').textContent, '(분석 중...)');
  requests.at(-1).success(completed('새 분석'));
  assert.match(field('aiContent').innerHTML, /새 분석/);
});

test('closing and reopening the same student rejects the earlier response', () => {
  const {c, field, requests} = fixture();
  c.openStudentModal('A');
  const old = requests.at(-1);
  c.closeModal();
  c.openStudentModal('A');
  old.success(saved('닫기 전 분석'));
  assert.doesNotMatch(field('aiContent').innerHTML, /닫기 전 분석/);
  requests.at(-1).success(saved('다시 연 분석'));
  assert.match(field('aiContent').innerHTML, /다시 연 분석/);
});

test('fallback completion is visibly distinguished from an AI response', async () => {
  const {c, field, requests} = fixture();
  c.openStudentModal('A');
  await c.requestAIAnalysis();
  requests.at(-1).success({...completed('기본 분석'), source: 'Fallback (API 키 없음)'});
  assert.equal(field('aiStatusBadge').textContent, '(기본 분석 완료)');
});

test('late save completion does not mark another student report as saved', () => {
  const {c, field, requests} = fixture();
  c.openStudentModal('A');
  requests.at(-1).success(saved('학생A 분석'));
  c.saveAIEdit();
  const old = requests.at(-1);
  assert.equal(old.args[0], 'A');
  c.openStudentModal('B');
  old.success({success: true});
  assert.equal(field('aiSavedBadge').style.display, 'none');
  old.failure(new Error('late failure'));
  assert.equal(field('aiSavedBadge').style.display, 'none');
});
