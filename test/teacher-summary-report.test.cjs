const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { root, makeSummaryFixture } = require('./fixtures/summary-report.cjs');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'vercel/public/js/teacher-report-files.js'), 'utf8'), context);
const files = context.window.teacherReportFiles;
const render = input => files.buildSummaryReportDocument(input).content;

test('renders two approved pages and keeps the sleep, wake, and condition in the target-day column', () => {
  const html = render(makeSummaryFixture());
  assert.equal((html.match(/<article class="summary-page"(?:>| )/g) || []).length, 2);
  for (const label of ['A. 카페인과 수면', 'B. 수면을 위한 행동과 결과', 'C. 카페인을 마신 날',
    'D. 수면과 생활습관', 'E. 기록 · 잘한 점', 'E. 기록 · 아쉬운 점', 'F. 돌아보기']) assert.ok(html.includes(label));
  assert.match(html, /data-row="bedtime"[^>]*>[\s\S]*?data-date="2026-11-01"[^>]*>01:21/);
  assert.match(html, /data-row="condition"[^>]*>[\s\S]*?data-date="2026-11-01"[^>]*>[\s\S]*?2점/);
  assert.match(html, /data-row="condition"[^>]*>[\s\S]*?빠짐[\s\S]*?아직/);
  assert.match(html, /안 마심/);
  assert.match(html, /기록 없음/);
  assert.match(html, /오늘/);
  assert.match(html, /수면 기록<\/span><strong>6 \/ 6일/);
  assert.match(html, /카페인 기록<\/span><strong>5 \/ 6일/);
  assert.match(html, /다음 날 아침 컨디션/);
});

test('suppresses both group averages when one side has one valid night', () => {
  const html = render(makeSummaryFixture());
  const condition = html.match(/data-compare="condition">([\s\S]*?)<\/article>/)[1];
  assert.match(condition, /마신 날 밤 \(3일\)/);
  assert.match(condition, /안 마신 날 밤 \(1일\)/);
  assert.match(condition, /비교 보류/);
  assert.doesNotMatch(condition, /<strong>[0-9.]+점/);
});

test('distinguishes the registered target, default maximum, and 8–10 hour bounds', () => {
  const personal = render(makeSummaryFixture());
  const defaults = render(makeSummaryFixture({ personal: false }));
  assert.match(personal, /하루 150mg 넘지 않기/);
  assert.match(defaults, /일일 최대 섭취량\(170mg\) 넘지 않기/);
  assert.match(personal, /8~10시간 취침/);
  assert.match(personal, />짧음</);
  assert.match(personal, />김</);
});

test('renders the full 14-day axis and escapes untrusted names and drink details', () => {
  const input = makeSummaryFixture({ length: 14 });
  input.student.이름 = '<script>not a name</script>';
  input.feedback.engine.findings.find(x => x.id === 'caffeineSummary').data.days
    .find(x => x.intakes.length).intakes[0].drink = '<img onerror=alert(1)>';
  const html = render(input);
  assert.equal((html.match(/data-row="dates">([\s\S]*?)<\/div>/)[1].match(/data-date=/g) || []).length, 14);
  assert.doesNotMatch(html, /<script>|<img onerror/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img onerror/);
});

test('empty reports never infer zero caffeine or insert invented reflections', () => {
  const html = render(makeSummaryFixture({ empty: true, personal: false }));
  assert.match(html, /카페인 기록<\/span><strong>0 \/ 6일/);
  assert.doesNotMatch(html, /class="summary-caf-zero"/);
  assert.match(html, /비교 보류/);
  assert.match(html, /잘된 점/);
  assert.doesNotMatch(html, /평균 [\d.]+점/);
});

test('preserves the existing PDF document and its layout', () => {
  const html = files.buildGoalPdfDocument(makeSummaryFixture(), { includeAi: true }, 'paper').html;
  assert.match(html, /class="goal-page"/);
  assert.doesNotMatch(html, /class="summary-page"/);
});

test('a one-day report distinguishes daytime today from the still-open night', () => {
  const html = files.buildSummaryReportDocument(makeSummaryFixture({ length: 1 }), {
    now: Date.parse('2026-11-04T20:00:00Z'),
  }).content;
  assert.match(html, /data-row="caffeine"[\s\S]*?>오늘<\/span>/);
  assert.match(html, /data-row="bedtime"[\s\S]*?data-date="2026-11-05"[^>]*>아직<\/span>/);
  assert.match(html, /수면 기록<\/span><strong>0 \/ 0일/);
});

test('does not relabel an inclusive midnight goal as strictly before midnight', () => {
  const input = makeSummaryFixture();
  const goal = input.feedback.engine.findings.find(x => x.id === 'goalProgress').data.goals[1];
  goal.label = '00:00까지 잠자리에 들기';
  const html = render(input);
  assert.match(html, /00:00까지 자기/);
  assert.doesNotMatch(html, /12시 전에 자기/);
});

test('reports missing and held sleep even if all past caffeine days were recorded', () => {
  const input = makeSummaryFixture();
  const caffeine = input.feedback.engine.findings.find(x => x.id === 'caffeineSummary').data.days;
  caffeine.filter(x => x.date < input.end).forEach(x => { x.recorded = true; });
  const sleep = input.feedback.engine.findings.find(x => x.id === 'bedtimeSeries').data.days;
  Object.assign(sleep[0], { recorded: false, hours: null, bed: null, wake: null, condition: null });
  Object.assign(sleep[1], { recorded: true, held: true, hours: null, bed: null, wake: null, condition: null });
  const html = render(input);
  assert.match(html, /수면 기록이 비어 있는 밤은 1일/);
  assert.match(html, /수면 분석을 보류한 밤은 1일/);
  assert.doesNotMatch(html, /확인한 기록에서 빠진 항목이 없어요/);
});
