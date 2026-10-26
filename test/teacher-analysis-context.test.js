import {installComparisonDisplay} from './support/comparison-display.js';
import {SleepRecordPolicy} from './support/sleep-policy.js';
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
    style: {}, innerHTML: '', textContent: '', value: '', contentEditable: 'false', scrollTop: 0, dataset:{}, querySelector(){return null;},
    classList: {add() {}, remove() {}, toggle() {}}, getContext() {return {};}
  };
  field('studentDateFilter').value = '2026-10-09';
  const runner = {withSuccessHandler(fn) {this.success = fn; return this;},
    withFailureHandler(fn) {this.failure = fn; return this;}};
  for (const action of ['getAIReport', 'handleAIReportForTeacher', 'saveAIReport']) runner[action] = function (...args) {
    requests.push({action, args, success: this.success, failure: this.failure});
  };
  const c = vm.createContext({SleepRecordPolicy,
    document: {getElementById: field, createElement: () => ({innerHTML: '', querySelectorAll: () => [], get textContent() {return this.innerHTML;}})}, window: {}, escapeHtml:String, google: {script: {run: runner}},
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
  installComparisonDisplay(c);vm.runInContext([
    'renderSleepComparisonDetails','getSleepTimingInfo','shortDate','formatSleepTime','sleepBehaviorLabel','chartSleepRowsForSummary','getSleepLifeDate','getSleepWakeDate','compareSleepDisplayTimesDesc','getSleepRecordEndKey','getLastNDates', 'getPeriodN', 'getModalDates', 'getSleepChartMax', 'compareSleepRecordsDesc',
    'getAIContextKey', 'isCurrentAIRequest', 'resetAIReportContext',
    'openStudentModal', 'closeModal', 'refreshModalData', 'setModalPeriod',
    'showAITools', 'loadSavedAIReport', 'requestAIAnalysis', 'saveAIEdit'
  ].map(extract).join('\n'), c);
  return {c, fields, field, requests};
}
const saved = text => ({success: true, policyVersion:'2026-10-14', content: text.repeat(10), savedAt: '검증'});
const completed = text => ({success: true, analysis: text.repeat(20), source: 'AI_Teacher'});

for (const nextStudent of ['A', 'B']) {
  test(`reopening student ${nextStudent} starts at the top after scrolling student A`, () => {
    const {c, field} = fixture();
    c.openStudentModal('A');
    field('studentModalContent').scrollTop = 1200;
    c.closeModal();
    c.openStudentModal(nextStudent);
    assert.equal(field('studentModalContent').scrollTop, 0);
    assert.equal(field('modalStudentId').textContent, nextStudent);
  });
}

test('switching students without closing also starts at the top', () => {
  const {c, field} = fixture();
  c.openStudentModal('A');
  field('studentModalContent').scrollTop = 1200;
  c.openStudentModal('B');
  assert.equal(field('studentModalContent').scrollTop, 0);
});

test('refreshing the current student period preserves the scroll position', () => {
  const {c, field} = fixture();
  c.openStudentModal('A');
  field('studentModalContent').scrollTop = 600;
  c.setModalPeriod('14');
  assert.equal(field('studentModalContent').scrollTop, 600);
});

test('legacy saved health reports stay out of the current report and PDF context',()=>{
  const {c,field,requests}=fixture();c.openStudentModal('A');
  requests.at(-1).success({success:true,content:'이전 기준 분석'.repeat(10),savedAt:'과거'});
  assert.match(field('aiContent').textContent,/이전 기준/);
  assert.equal(c.aiReportContextKey,'');
});

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

test('modal shows recorded sleep days separately from the selected period', () => {
  const {c, field} = fixture();
  installComparisonDisplay(c);vm.runInContext(['avgSleepForDates', 'countSleepDays'].map(extract).join('\n'), c);
  c.chartSleepRowsForSummary=id=>id==='A'?[{id:'a'}]:[];
  c.findSleepForLifeDate = (id, date) => id === 'A' && date === '2026-10-08' ? {시간: 7.5,컨디션:'😊'} : null;
  c.openStudentModal('A');
  assert.equal(field('modalAvgSleep').textContent, '7.5h');
  assert.equal(field('modalSleepRecordBasis').textContent, '수면 1건 · 유효 1일 / 비교 7일 (기상일 전날)');
  assert.equal(field('modalAvgCondition').textContent, '5.0점 · 기록 1/7일');
  c.setModalPeriod('14');
  assert.equal(field('modalAvgSleep').textContent, '7.5h');
  assert.equal(field('modalSleepRecordBasis').textContent, '수면 1건 · 유효 1일 / 비교 14일 (기상일 전날)');
  c.openStudentModal('B');
  assert.equal(field('modalAvgSleep').textContent, '-');
  assert.equal(field('modalSleepRecordBasis').textContent, '수면 0건 · 유효 0일 / 비교 7일 (기상일 전날)');
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

for(const [value,expected]of [[7.166666666666667,'7.2h'],[7.04,'7.0h'],[7.05,'7.1h'],[0,'0.0h'],[null,'-']])test('teacher actual modal/tooltip display keeps raw average '+String(value),()=>{const {c,field}=fixture();c.avgSleepForDates=()=>value;c.findSleepForLifeDate=()=>value===null?null:{시간:value};c.Chart=function(_,config){Object.assign(this,config);this.destroy=()=>{};};c.openStudentModal('A');assert.equal(field('modalAvgSleep').textContent,expected);const chart=c.charts.dual;assert.equal(chart.data.datasets[2].data[0].y,value);const label=chart.options.plugins.tooltip.callbacks.label({datasetIndex:2,dataset:{label:'수면'},raw:{y:value}});assert.ok(value===null?label.includes('미기록'):label.includes(expected));});
