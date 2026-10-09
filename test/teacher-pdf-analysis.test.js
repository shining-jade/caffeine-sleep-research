import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync('teacher/index.html', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 9);
  return source.slice(start, end < 0 ? undefined : end);
}
function exportReport(status, {includeAi = true, contextMatches = true, content = '<div>저장한 건강 관찰 소견입니다. 평균 카페인 52mg, 평균 수면 12시간으로 확인했습니다. 기록일 기준으로 계산했습니다.</div>'} = {}) {
  const fields = {};
  const field = id => fields[id] ||= {style: {}, innerHTML: '', textContent: '', getContext() {return {};}, querySelector() {return null;}};
  field('aiStatusBadge').textContent = status;
  field('aiContent').innerHTML = content;
  const c = vm.createContext({
    studentsData: [{학번: '0', 이름: '합성학생'}], currentStudentId: '0', today: '2026-10-09',
    document: {title: '교사', getElementById: field},
    getModalDates: () => ['2026-10-03', '2026-10-09'], getLimit: () => 170,
    aiReportContextKey: contextMatches ? 'current' : 'previous', getAIContextKey: () => 'current',
    getTargetCafText: () => '150mg', getTargetSleepCompactText: () => '23:00 / 07:00 / 8h',
    avgCafForDates: () => 52, avgSleepForDates: () => 12, hasCafRecordOnDates: () => true,
    getCafStatusInfo: () => ({text: '1단계: 안전'}), getSleepStatusInfo: () => ({text: '수면 과다'}),
    caffeineData: [], sleepData: [], charts: {},
    evaluateAwards: () => [], getManualAwardsFor: () => [], findSleepForLifeDate: () => null,
    getTargetCafLimit: () => 150, getTargetSleepHours: () => 8, getCafBarColor: () => '#aaa',
    Chart: function () {}, setTimeout() {}
  });
  vm.runInContext(['getDefaultPDFOptions', 'normalizePDFOptions', 'compactPDFAIHTML', 'getSleepChartMax', 'compareSleepRecordsDesc', 'setPDFSectionVisible', 'exportPDF'].map(extract).join('\n'), c);
  c.exportPDF({pdfOptions: {includeAi}});
  return fields;
}

test('PDF includes a saved analysis reloaded from the server', () => {
  const fields = exportReport('(저장된 분석 ✓)');
  assert.equal(fields.pdf_aiBox.style.display, 'block');
  assert.match(fields.pdf_aiContent.innerHTML, /평균 카페인 52mg/);
});

test('PDF includes freshly completed analysis', () => {
  assert.equal(exportReport('(분석 완료 ✓)').pdf_aiBox.style.display, 'block');
});

test('PDF respects the unchecked analysis option for a saved report', () => {
  assert.equal(exportReport('(저장된 분석 ✓)', {includeAi: false}).pdf_aiBox.style.display, 'none');
});

test('PDF omits insufficient-data explanations and analysis still in progress', () => {
  for (const status of ['(데이터 부족)', '(분석 중...)', '(분석 전)']) {
    assert.equal(exportReport(status).pdf_aiBox.style.display, 'none');
  }
});

test('PDF rejects analysis associated with a different student or period', () => {
  for (const status of ['(저장된 분석 ✓)', '(분석 완료 ✓)']) {
    assert.equal(exportReport(status, {contextMatches: false}).pdf_aiBox.style.display, 'none');
  }
});
