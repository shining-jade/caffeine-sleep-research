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

test('reports delayed caffeine from intake date and sleep from actual wake date in KST', () => {
  const report = makeSummaryFixture({ editDays(days) {
    // 11.01 intake saved at midnight on 11.02 KST, despite the UTC date being 11.01.
    days[2].caffeine.intakes[0].enteredAt = '2026-11-01T15:00:00Z';
    // 11.01 night ends on 11.02; same-wake-day saves are not delayed.
    days[2].sleep.wakeDate = '2026-11-02';
    days[2].sleep.enteredAt = '2026-11-01T14:59:59-01:00';
    days[3].sleep.wakeDate = '2026-11-03';
    days[3].sleep.enteredAt = '2026-11-03T15:00:00Z';
    days[4].caffeine.intakes[0].enteredAt = 'invalid';
  } });
  const late = report.feedback.engine.summaryLateEntries;
  assert.deepEqual(JSON.parse(JSON.stringify(late)), [
    { kind: 'caffeine', date: '2026-11-01', delayDays: 1, count: 1 },
    { kind: 'sleep', date: '2026-11-02', delayDays: 1, count: 1 },
  ]);
  const html = render(report);
  assert.match(html, /11\.01 카페인은 다음 날 입력했어요/);
  assert.match(html, /11\.02 밤 수면은 일어난 다음 날 입력했어요/);
  assert.doesNotMatch(render(makeSummaryFixture()), /다음 날 입력했어요|저장 시각 기준/);
});

test('uses sheet timestamps in the report input and does not output raw timestamps', () => {
  const { gas } = require('./fixtures/summary-report.cjs');
  const student = { id: 'synthetic', dashboardId: 'synthetic_가상', name: '가상' };
  const caffeine = [['2026-11-01T15:00:00Z', '', '', '', student.id, student.name, '가상 음료', 40, '2026-11-01 17:30:00']];
  const sleep = [['2026-11-02 09:00:00', '', '', '', student.id, student.name, '2026-11-01', '23:00', '2026-11-02', '07:00', 8, 3, '', 'synthetic-record']];
  const source = { caffeine, sleep, sleepMetadata: { groups: new Map() }, sleepIds: new Map(), info: [] };
  const input = gas.feedbackSourceInput_(source, student, '2026-11-01', '2026-11-01', [], { today: '2026-11-05' });
  assert.equal(input.days[0].caffeine.intakes[0].enteredAt, caffeine[0][0]);
  assert.equal(input.days[0].sleep.enteredAt, sleep[0][0]);
  assert.equal(input.days[0].sleep.wakeDate, '2026-11-02');
  const report = gas.buildFeedbackReport_(input);
  assert.equal(report.summaryLateEntries.length, 1);
  assert.doesNotMatch(JSON.stringify(report), /2026-11-01T15:00:00Z|2026-11-02 09:00:00/);
});

test('shows only three delayed groups and counts the hidden records', () => {
  const report = makeSummaryFixture({ editDays(days) {
    for (const day of days) {
      day.sleep.wakeDate = new Date(Date.parse(day.date) + 86400000).toISOString().slice(0, 10);
      day.sleep.enteredAt = '2026-11-06 09:00:00';
    }
  } });
  const html = render(report);
  assert.equal((html.match(/밤 수면은 일어난/g) || []).length, 3);
  assert.match(html, /외 3건/);
});

test('adds a recorded overlap only when it occurred on at least two missed nights', () => {
  const normal = makeSummaryFixture();
  assert.match(normal.feedback.engine.summaryReflection.rule.difficulty, /4일 중 3일은 자기 전 스마트폰을 30분 이상/);
  const sparse = makeSummaryFixture({ editDays(days) {
    days.forEach((day, i) => {
      day.habits.phone = i === 2 ? '60분 이상' : null;
      day.caffeine?.intakes.forEach(item => { item.time = i === 2 ? '17:30' : '12:00'; });
    });
  } });
  assert.equal(sparse.feedback.engine.summaryReflection.facts.difficulty.observation, null);
  assert.doesNotMatch(sparse.feedback.engine.summaryReflection.rule.difficulty, /스마트폰|오후 3시/);
});

test('AI receives only allowed aggregate facts; rejects novel wording and retains the three rules on failure', async () => {
  const { createTeacherOpenAI } = await import('../vercel/api/_lib/teacher-openai.js');
  const report = makeSummaryFixture();
  const makeData = () => structuredClone({ success: true, reports: [{ ...report, studentId: 'synthetic-only' }] });
  const rule = report.feedback.engine.summaryReflection.rule;
  const safeChoices = { praise: 'warm', difficulty: 'warm', plan: 'warm' };
  const completed = value => new Response(JSON.stringify({ status: 'completed', output: [
    { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
  ] }));
  let calls = 0;
  const success = createTeacherOpenAI({ readKey: () => 'fixture-only', fetchImpl: async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.store, false);
    assert.doesNotMatch(request.input, /synthetic-only|테스트 학생|가상|2026-|하루 150mg/);
    assert.deepEqual(Object.keys(JSON.parse(request.input)[0]), ['praise', 'difficulty', 'plan']);
    return completed({ choices: [safeChoices] });
  } });
  const polished = await success(makeData());
  assert.equal(calls, 1);
  assert.equal(polished.reports[0].feedback.mode, 'ai');
  assert.equal(polished.reports[0].feedback.aiFallback, false);
  assert.notEqual(polished.reports[0].feedback.summaryReflection.praise, rule.praise);
  assert.deepEqual(polished.reports[0].feedback.sections, makeData().reports[0].feedback.sections);
  for (const fetchImpl of [async () => { throw Error('offline'); },
    async () => completed({ choices: [{ ...safeChoices, difficulty: '진단: 99시간' }] })]) {
    const fallback = await createTeacherOpenAI({ readKey: () => 'fixture-only', fetchImpl })(makeData());
    const { feedback } = fallback.reports[0];
    assert.equal(feedback.aiFallback, true);
    assert.equal(feedback.mode, 'rule');
    assert.deepEqual(feedback.summaryReflection, structuredClone(rule));
    assert.match(render(fallback.reports[0]), /스마트폰을 30분 이상/);
  }
});

test('recognizes a numeric Seoul sheet timestamp and uses observed kept-day facts for a caffeine plan', () => {
  const { gas } = require('./fixtures/summary-report.cjs');
  const day = '2026-11-01';
  const entry = 25569 + Date.parse('2026-11-02T00:01:00Z') / 86400000;
  const input = { start: day, end: '2026-11-03', today: '2026-11-05',
    goals: [{ id: 'caffeine-goal', source: 'class', criterion: 'caffeineMax', label: '하루 100mg 넘지 않기', threshold: 100 }],
    days: [40, 150, 160].map((mg, i) => ({ date: '2026-11-0' + (i + 1),
      caffeine: { recorded: true, totalMg: mg, intakes: [{ time: '14:00', mg, enteredAt: i === 0 ? entry : null }] } })) };
  const result = gas.buildFeedbackReport_(input);
  assert.equal(result.summaryLateEntries.length, 1);
  assert.equal(result.summaryLateEntries[0].delayDays, 1);
  assert.equal(result.summaryReflection.facts.plan.kind, 'recordedCaffeine');
  assert.match(result.summaryReflection.rule.plan, /11\.01 낮처럼 카페인 섭취량을 40mg 정도로 맞춰 보기/);
});

test('keeps daily report cells through 14 days and switches both sections at 15', () => {
  for (const length of [7, 14]) {
    const html = render(makeSummaryFixture({ length }));
    assert.match(html, /data-row="dates"/);
    assert.match(html, /날짜별 목표 실천 달력/);
    assert.doesNotMatch(html, /주차별 평균 표|주차별 목표 실천 표/);
  }
  const html = render(makeSummaryFixture({ length: 15 }));
  assert.doesNotMatch(html, /data-row="dates"|날짜별 목표 실천 달력/);
  assert.match(html, /주차별 평균 표/);
  assert.match(html, /주차별 목표 실천 표/);
  assert.match(html, /3주차<\/strong><small>[\s\S]*?>11\.05<\/span> <span class="summary-week-days">· 1일/);
  assert.equal((html.match(/<article class="summary-page"(?:>| )/g) || []).length, 2);
});

test('uses independent weekly sample counts, midnight-safe bedtime and 0 mg for no intake', () => {
  const report = makeSummaryFixture({ length: 15, editDays(days) {
    days.forEach((day, i) => {
      day.caffeine = undefined; day.sleep = undefined;
      if (i === 0) day.caffeine = { recorded: true, totalMg: 0, intakes: [] };
      if (i === 1) day.caffeine = { recorded: true, totalMg: 100, intakes: [{ time: '13:00', mg: 100 }] };
      if (i === 2) day.caffeine = { recorded: true, totalMg: null, intakes: [{ time: '13:00', mg: null }] };
      if (i < 2) day.sleep = { recorded: true, bedOnTimeline: i === 0 ? 1350 : 1530,
        hours: i === 0 ? 8 : null, condition: i === 0 ? null : 4 };
      if (i === 3) day.sleep = { recorded: true, held: true, bedOnTimeline: 1200, hours: 20, condition: 1 };
    });
  } });
  const html = render(report);
  const row = key => html.match(new RegExp('data-weekly-metric="'+key+'"[^>]*>(.*?)</tr>', 's'))[1];
  assert.match(row('caffeine'), /<strong>50mg<\/strong><small>2일/);
  assert.match(row('caffeine'), /<strong>–<\/strong><small>0일/);
  assert.match(row('bedtime'), /<strong>00:00<\/strong><small>2일/);
  assert.match(row('hours'), /<strong>8\.0시간<\/strong><small>1일/);
  assert.match(row('condition'), /<strong>4\.0점<\/strong><small>1일/);
  assert.match(html, /비교 보류/);
});

test('weekly goal rows use only eligible days, include weighted totals and distinguish 0/0', () => {
  const report = makeSummaryFixture({ length: 30, editDays(days) {
    days.forEach((day, i) => {
      const amount = [0, 200, null, 0, 200, 200, null, 0][i] ?? null;
      day.caffeine = amount === null ? undefined : { recorded: true, totalMg: amount, intakes: [] };
    });
  } });
  const html = render(report);
  const goal = html.match(/data-weekly-goal="class-caffeine"[^>]*>(.*?)<\/tr>/s)[1];
  assert.match(goal, /class="summary-ratio rate-1">2\/5/);
  assert.match(goal, /class="summary-ratio rate-4">1\/1/);
  assert.match(goal, /class="summary-ratio no-data">0\/0/);
  assert.match(goal, /class="summary-ratio rate-2">3\/6/);
  assert.match(html, /5주차<\/strong><small>[\s\S]*?>11\.04~11\.05<\/span> <span class="summary-week-days">· 2일/);
  assert.match(html, /scope="col" class="summary-week-total">전체/);
});

test('long selections keep every week and the total within the two report articles', () => {
  const html = render(makeSummaryFixture({ length: 100, empty: true }));
  assert.match(html, /15주차/);
  assert.equal((html.match(/data-weekly-metric="caffeine"/g) || []).length, 3);
  assert.equal((html.match(/scope="col" class="summary-week-total">전체/g) || []).length, 1);
  assert.equal((html.match(/<article class="summary-page"(?:>| )/g) || []).length, 2);
});

test('weekly tables include all goals, including goals beyond the daily display limit', () => {
  const report = makeSummaryFixture({ length: 15 });
  const goals = report.feedback.engine.findings.find(item => item.id === 'goalProgress').data.goals;
  for (let i = 0; i < 4; i++) goals.push({ ...goals[0], id: 'fixture-goal-' + i, label: '가짜 목표 ' + i });
  const html = render(report);
  for (let i = 0; i < 4; i++) assert.match(html, new RegExp('data-weekly-goal="fixture-goal-' + i + '"'));
  assert.doesNotMatch(html, /처음 4개를 표시/);
});

test('teacher report classifies the caffeine limit without forwarding a weight', () => {
  const source = fs.readFileSync(path.join(root, 'vercel/teacher/index.html'), 'utf8');
  const fn = source.slice(source.indexOf('function getLimit('), source.indexOf('function getPersonalInfo('));
  const context = vm.createContext({ S: { cafMaxFixed: 0 } });
  vm.runInContext(fn, context);
  const get = (weight, recorded) => JSON.parse(JSON.stringify(context.getLimit('0',
    { 몸무게: weight, hasRecordedWeight: recorded }, { withBasis: true })));
  assert.deepEqual(get(68, true), { limit: 170, limitBasis: 'weight' });
  assert.deepEqual(get(160, true), { limit: 400, limitBasis: 'weight' });
  assert.deepEqual(get(165, true), { limit: 400, limitBasis: 'weightCapped' });
  assert.deepEqual(get(60, false), { limit: null, limitBasis: 'noWeight' });
  assert.deepEqual(get(60, undefined), { limit: null, limitBasis: 'noWeight' });
  assert.deepEqual(get(0, true), { limit: null, limitBasis: 'noWeight' });
  context.S.cafMaxFixed = 185;
  assert.deepEqual(get(0, false), { limit: 185, limitBasis: 'fixed' });
});

function reportWithLimit(basis, amount, options = {}) {
  const { gas } = require('./fixtures/summary-report.cjs');
  return makeSummaryFixture({ ...options, buildEngine: input =>
    gas.buildFeedbackReport_({ ...input, caffeineLimitBasis: basis, caffeineLimitMg: amount }) });
}

const standardsFootnote = '<div class="summary-foot-standards"><p>청소년 일일 최대 섭취량 = 내 체중 × 2.5mg(식품의약품안전처)</p>' +
  '<p>청소년 권장 수면 8~10시간(미국수면의학회, 2016)</p></div>';

for (const [basis, amount] of [
  ['weight', 170],
  ['weightCapped', 400],
  ['fixed', 185],
]) {
  test('report shows the ' + basis + ' amount and the shared footnotes', () => {
    const report = reportWithLimit(basis, amount, { personal: false });
    assert.deepEqual(JSON.parse(JSON.stringify(report.feedback.engine.summaryCaffeineLimit)), { basis, amountMg: amount });
    const html = render(report);
    assert.ok(html.includes(standardsFootnote));
    assert.match(html, new RegExp('일일 최대 섭취량\\('+amount+'mg\\) 넘지 않기'));
    assert.doesNotMatch(html, /\b(?:60|68|165)\s*kg/);
  });
}

test('noWeight shows an unjudged row for daily and weekly reports while personal goals still count', () => {
  for (const length of [7, 15]) {
    const report = reportWithLimit('noWeight', 150, { length });
    const engine = report.feedback.engine;
    assert.deepEqual(JSON.parse(JSON.stringify(engine.summaryCaffeineLimit)), { basis: 'noWeight', amountMg: null });
    assert.ok(engine.findings.find(x => x.id === 'healthStandards').data.rows.every(x => x.id !== 'caffeineMax'));
    const html = render(report);
    const row = length === 7
      ? html.match(/data-daily-goal="caffeineMax">([\s\S]*?)<\/div>\s*<div class="summary-goal-row/)[1]
      : html.match(/data-weekly-goal="caffeineMax">([\s\S]*?)<\/tr>/)[1];
    assert.match(row, /일일 최대 섭취량 넘지 않기/);
    assert.match(row, /체중 정보 없음/);
    assert.match(row, />–</);
    assert.doesNotMatch(row, />✓<|>×<|>아직<|>0\/0<|150mg/);
    assert.match(html, /하루 150mg 넘지 않기/);
    if (length === 7) assert.match(html, /summary-goal-total">5\/5/);
    assert.ok(html.includes(standardsFootnote));
  }
});

test('saved summary wording reaches the exported report as text without replacing calculations', () => {
  const report = makeSummaryFixture();
  report.feedback.summaryEdit = {
    praise: '꾸준히 기록했어요.',
    difficulty: '목표를 다시 살펴봐요.',
    plan: '내일도 같은 시간에 기록하기',
    memo: '작은 변화부터 이어 가요. <기록>',
    caffeineSleep: 'A 영역 가짜 설명', behavior: 'B 영역 가짜 설명',
    caffeineDays: 'C 영역 가짜 설명', sleepHabits: 'D 영역 가짜 설명',
    recordGood: 'E 영역 가짜 칭찬', recordReview: 'E 영역 가짜 아쉬운 점 <수정>'
  };
  const html = render(report);
  for (const value of ['꾸준히 기록했어요.', '목표를 다시 살펴봐요.', '내일도 같은 시간에 기록하기', '작은 변화부터 이어 가요. &lt;기록&gt;',
    'A 영역 가짜 설명', 'B 영역 가짜 설명', 'C 영역 가짜 설명', 'D 영역 가짜 설명',
    'E 영역 가짜 칭찬', 'E 영역 가짜 아쉬운 점 &lt;수정&gt;']) {
    assert.ok(html.includes(value), value);
  }
  assert.doesNotMatch(html, /<기록>|<수정>/);
  assert.match(html, /하루 150mg 넘지 않기/);
  report.feedback.summaryEdit.memo = { text:'색상 메모 <가짜>', html:'<b>색상 메모 &lt;가짜&gt;</b>' };
  assert.match(render(report), /색상 메모 &lt;가짜&gt;/);
});

test('summary edits persist by report mode and preserve existing saved feedback text', () => {
  const gas = vm.createContext({
    Utilities: { formatDate: () => '2026-11-05 15:00:00' },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'gas/Code.js'), 'utf8'), gas);
  const saved = [['이름','학번','시작일','종료일','내용','저장일시','정책버전'],
    ['테스트 학생','0','2026-10-30','2026-11-05','기존 피드백','2026-11-05','2026-10-14']];
  const summaryRows = [];
  const sheets = {
    students: { getDataRange: () => ({ getValues: () => [[],[1,1,1,'테스트 학생','0']] }) },
    ai_reports: {
      getDataRange: () => ({ getValues: () => saved.map(row => row.slice()) }),
      getRange(row, col) { return { setValue(value) { saved[row-1][col-1] = value; } }; },
    },
  };
  gas.getSpreadsheet_ = () => ({
    getSheetByName: name => sheets[name],
    insertSheet(name) {
      assert.equal(name, 'teacher_report_edits');
      return (sheets[name] = {
        appendRow: row => summaryRows.push(Array.from(row)), setFrozenRows() {},
        getDataRange: () => ({ getValues: () => summaryRows.map(row => row.slice()) }),
        getRange(row, col) { return { setValue(value) { summaryRows[row-1][col-1] = value; } }; },
      });
    },
  });
  const args = ['0','2026-10-30','2026-11-05'];
  const edit = { praise:'기록했어요.',difficulty:'한 가지씩 봐요.',plan:'다음 주도 기록하기',memo:'메모' };
  assert.equal(gas.saveAIReport(...args, '', '테스트 학생', { mode:'ongoing', ...edit }).success, true);
  assert.equal(gas.saveAIReport(...args, '', '테스트 학생', { mode:'final', ...edit, memo:'마무리' }).success, true);
  assert.equal(gas.saveAIReport(...args, '', '다른 학생', { mode:'final', ...edit }).success, false);
  assert.equal(gas.saveAIReport(...args, '', '테스트 학생', { mode:'ongoing', ...edit, memo:'고친 메모' }).success, true);
  assert.equal(gas.saveAIReport(...args, '', '테스트 학생', { mode:'ongoing', caffeineSleep:'새 설명', recordReview:'' }).success, true);
  assert.equal(gas.saveAIReport(...args, '', '테스트 학생', { mode:'ongoing', behavior:123 }).success, false);
  assert.equal(gas.saveAIReport(...args, '', '테스트 학생', { mode:'ongoing', feedbackHtml:'<p><b>굵게</b> <span style="color: #b91c1c">빨강</span></p>' }).success, true);
  const formattedMemo = { text: '굵은 가짜 메모', html: '<b><span style="color:#1d4ed8">굵은 가짜 메모</span></b>' };
  assert.equal(gas.saveAIReport(...args, '', '테스트 학생', { mode:'final', memo:formattedMemo }).success, true);
  const loaded = gas.getAIReport(...args, '테스트 학생');
  assert.equal(loaded.content, '기존 피드백');
  assert.equal(summaryRows.length, 3);
  assert.equal(loaded.summaryEdits.ongoing.memo, '고친 메모');
  assert.equal(loaded.summaryEdits.ongoing.caffeineSleep, '새 설명');
  assert.equal(loaded.summaryEdits.ongoing.recordReview, '');
  assert.match(loaded.summaryEdits.ongoing.feedbackHtml, /<b>굵게<\/b>.*#b91c1c/);
  assert.equal(loaded.summaryEdits.final.feedbackHtml, undefined);
  assert.equal(loaded.summaryEdits.final.caffeineSleep, undefined);
  assert.equal(gas.getAIReport(...args, '다른 학생').summaryEdits.ongoing, undefined);
  assert.equal(loaded.summaryEdits.final.memo.text, formattedMemo.text);
  assert.equal(loaded.summaryEdits.final.memo.html, formattedMemo.html);
  gas.feedbackSourceRows_ = () => ({ caffeine:[], sleep:[], info:[], sleepIds:new Map(), sleepMetadata:new Map() });
  gas.feedbackClassRows_ = () => [];
  const batch = gas.analyzeTeacherBatch({ start:args[1], end:args[2], reportVersion:2, reportMode:'ongoing', includeSavedReportEdits:true,
    students:[{ studentId:args[0], studentName:'테스트 학생' }] });
  assert.equal(batch.reports[0].feedback.summaryEdit.memo, '고친 메모');
  assert.equal(batch.reports[0].feedback.summaryEdit.feedbackHtml, loaded.summaryEdits.ongoing.feedbackHtml);
  const automatic = gas.analyzeTeacherBatch({ start:args[1], end:args[2], reportVersion:2,
    students:[{ studentId:args[0], studentName:'테스트 학생' }] });
  assert.equal(automatic.reports[0].feedback.summaryEdit, undefined);
});
