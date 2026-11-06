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
  const condition = html.match(/data-row="condition"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/)[1];
  assert.equal((condition.match(/>기록 없음<\/span>/g) || []).length, 2);
  assert.doesNotMatch(condition, /빠짐/);
  assert.match(html, />수면시간<small>/);
  assert.match(html, /data-row="hours"[\s\S]*?data-date="2026-11-03"[^>]*>[\s\S]*?<span>8<\/span>/);
  assert.match(html, /안 마심/);
  assert.match(html, /기록 없음/);
  assert.match(html, /오늘/);
  assert.match(html, /수면 기록<\/span><strong>6 \/ 6일/);
  assert.match(html, /카페인 기록<\/span><strong>5 \/ 6일/);
  assert.match(html, />카페인<small>mg/);
  assert.match(html, />취침시각<\/span>/);
  assert.match(html, />기상시각<\/span>/);
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
  assert.match(personal, /8~10시간인 밤\(2일\) 평균[\s\S]*?\(반올림 전 기준\)/);
  assert.match(personal, /class="summary-mark short"><span>짧음<\/span><small class="summary-mark-hours">6h<\/small>/);
  const longNight = makeSummaryFixture({ editDays(days) { days[0].sleep.hours = 11.7; } });
  assert.match(render(longNight), /class="summary-mark long"><span>긺<\/span><small class="summary-mark-hours">12h<\/small>/);
});

test('rounds sleep to whole hours before checking the daily and weekly goal and reflection', () => {
  const fixture = length => makeSummaryFixture({ length, editDays(days) {
    const hours = [7.49, 7.5, 7.8, 10.49, 10.5];
    days.forEach((day, index) => {
      if (index < hours.length) day.sleep.hours = hours[index];
      else delete day.sleep;
    });
  } });
  const report = fixture(7);
  const html = render(report);
  const row = html.match(/data-daily-goal="range"[^>]*>([\s\S]*?)<\/span><\/div>/)[1];
  const marks = [...row.matchAll(/class="summary-mark (\w+)"/g)].map(match => match[1]);
  assert.deepEqual(marks, ['near', 'ok', 'ok', 'ok', 'near', 'missing', 'missing']);
  assert.match(row, /class="summary-mark near">7h<\/span>/);
  assert.match(row, /class="summary-mark near">11h<\/span>/);
  assert.match(row, /class="summary-goal-total">3\/5$/);
  assert.match(html, /수면시간은 반올림해 판정/);
  assert.equal(report.feedback.engine.summaryReflection.facts.difficulty.kind, 'range');
  assert.equal(report.feedback.engine.summaryReflection.facts.difficulty.kept, 3);
  assert.match(report.feedback.engine.summaryReflection.rule.difficulty, /5일 중 3일/);
  const weekly = render(fixture(15)).match(/data-weekly-goal="range"[^>]*>([\s\S]*?)<\/tr>/)[1];
  assert.equal((weekly.match(/>3\/5<\/span>/g) || []).length, 2);
  assert.match(weekly, />0\/0<\/span>/);
});

test('fills the first teacher note consistently and keeps saved notes and deliberate blanks', () => {
  const report = makeSummaryFixture();
  const memo = () => render(report).match(/data-summary-text="memo">([^<]*)<\/p>/)[1];
  const initial = memo();
  assert.ok(initial.trim());
  assert.equal(memo(), initial);
  report.feedback.savedPdfFeedback = { summary: '저장한 가짜 메모' };
  assert.equal(memo(), '저장한 가짜 메모');
  report.feedback.summaryEdit = { memo: '직접 고친 가짜 메모' };
  assert.equal(memo(), '직접 고친 가짜 메모');
  report.feedback.summaryEdit.memo = '';
  assert.equal(memo(), '');
});

function caffeineReport(entriesByDay) {
  return makeSummaryFixture({ length: entriesByDay.length + 1, editDays(days) {
    days.forEach((day, i) => {
      const intakes = entriesByDay[i];
      day.caffeine = intakes && { recorded: true, totalMg: intakes.reduce((sum, item) => sum + (item.mg || 0), 0), intakes };
    });
  } });
}

const caffeineSection = html => html.match(/<h2>C\. 카페인을 마신 날<\/h2>[\s\S]*?<\/section>/)[0];
const caffeineCard = (html, key) => html.match(new RegExp('data-caffeine-card="' + key + '">([\\s\\S]*?)</article>'))[1];

test('ranks drinks by servings, sums known amounts and groups all items after the fourth', () => {
  const entries = [
    ...Array.from({ length: 5 }, () => ({ drink:'아이스  커피', mg:200 })),
    ...Array.from({ length: 4 }, () => ({ drink:'녹차', mg:50 })),
    ...Array.from({ length: 3 }, () => ({ drink:'카페라떼', mg:100 })),
    ...Array.from({ length: 2 }, () => ({ drink:'에너지음료', mg:80 })),
    { drink:'콜라', mg:20 }, { drink:'홍차', mg:null },
  ];
  const html = caffeineSection(render(caffeineReport([entries])));
  assert.doesNotMatch(html, /summary-intakes|<table/);
  assert.equal((html.match(/data-caffeine-card=/g) || []).length, 4);
  const card = caffeineCard(html, 'drink');
  assert.match(card, /아이스 커피[\s\S]*?5번 <small>1,000mg<\/small>[\s\S]*?녹차[\s\S]*?4번[\s\S]*?카페라떼[\s\S]*?3번[\s\S]*?에너지음료[\s\S]*?2번[\s\S]*?기타 \(콜라 등\)[\s\S]*?2번 <small>20mg<\/small>/);
  assert.doesNotMatch(card, /홍차/);
  assert.match(html, /섭취 16번 · 마신 날 1일/);
  assert.match(html, /가장 자주 마신 건 ‘아이스 커피’\(5번\)예요/);
  const unknown = caffeineCard(caffeineSection(render(caffeineReport([[{ drink:'', mg:null }]]))), 'drink');
  assert.match(unknown, /이름 없음[\s\S]*?1번/);
  assert.doesNotMatch(unknown, /0mg/);
});

test('counts each selected reason and symptom and separates the 15:00 boundary from missing times', () => {
  const report = caffeineReport([[
    { drink:'가상 커피', time:'14:59', mg:40, reason:'졸음을 깨려고, 습관적으로', symptom:'손이 떨렸다, 가슴이 두근거렸다' },
    { drink:'가상 커피', time:'15:00', mg:40, reason:'졸음을 깨려고', symptom:'없음, 해당 없음' },
    { drink:'가상 차', time:null, mg:40, reason:'공부나 일에 집중이 필요해서, 습관적으로', symptom:'없음, 손이 떨렸다' },
    { drink:'가상 차', time:'18:00', mg:40, symptom:'' },
  ]]);
  const html = render(report);
  const c = caffeineSection(html);
  assert.match(caffeineCard(c, 'time'), /data-caffeine-time="morning"[\s\S]*?0번[\s\S]*?data-caffeine-time="midday"[\s\S]*?1번[\s\S]*?data-caffeine-time="afternoon"[\s\S]*?1번[\s\S]*?data-caffeine-time="evening"[\s\S]*?1번/);
  assert.match(caffeineCard(c, 'drink'), /가상 차[\s\S]*?2번/);
  assert.match(caffeineCard(c, 'reason'), /졸음을 깨려고[\s\S]*?2번[\s\S]*?습관적으로[\s\S]*?2번[\s\S]*?공부·일에 집중[\s\S]*?1번/);
  assert.match(caffeineCard(c, 'symptom'), /적은 3번 중[\s\S]*?없음 1번[\s\S]*?있음 2번[\s\S]*?손이 떨렸다[\s\S]*?2번[\s\S]*?가슴이 두근거렸다[\s\S]*?1번/);
  assert.match(c, /15시 이후에 마신 건 2번이에요/);
  assert.match(c, /불편함을 적은 2번 중 0번은 15시 이후였어요/);
  assert.doesNotMatch(c, /가장 자주 마신 건/);
  assert.doesNotMatch(html, /섭취 기록에서 시각 1건이 빠졌어요/);
});

test('keeps missing caffeine out of section C and counts only explicit zero days in the infographic', () => {
  const html = render(caffeineReport([[], null, [], [], null, []]));
  const c = caffeineSection(html);
  assert.doesNotMatch(c, /기록 없는 날|카페인 기록이 없는 날/);
  assert.match(html, /카페인 기록이 없는 날은 2일이에요 \(10\.31, 11\.03\)\./);
  assert.match(html, /class="summary-caf-missing">기록 없음/);
  assert.match(c, /섭취 0번 · 안 마신 날 4일<\/span>/);
  assert.match(c, /class="summary-caf-none"/);
  assert.match(c, />0<small>mg<\/small>/);
  assert.match(c, /<b>2일<\/b>가장 길게 이어진 날/);
  assert.match(c, /11\.01부터 11\.02까지 2일 이어졌어요/);
  assert.equal((c.match(/class="summary-caf-chip"/g) || []).length, 4);
  const single = caffeineSection(render(caffeineReport([[], null])));
  assert.doesNotMatch(single, /가장 길게/);
  const empty = caffeineSection(render(caffeineReport([null, null])));
  assert.match(empty, /표시할 섭취 내역이 없어요/);
  assert.doesNotMatch(empty, /0mg|summary-caf-none/);
});

test('uses four charts for a few intakes and preserves the single-symptom observation and teacher edit', () => {
  const report = caffeineReport([[
    { drink:'가상 차', time:'09:00', mg:30, symptom:'없음' },
    { drink:'가상 커피', time:'16:00', mg:60, symptom:'잠이 잘 안 왔다' },
  ]]);
  const c = caffeineSection(render(report));
  assert.equal((c.match(/data-caffeine-card=/g) || []).length, 4);
  assert.match(c, /표시할 응답이 없어요/);
  assert.match(c, /16:00에 카페인을 마시고 ‘잠이 잘 안 왔다’고 적었어요\. 그날 밤 23:27에 잠들었어요/);
  report.feedback.summaryEdit = { caffeineDays:'교사가 고친 가짜 관찰' };
  const edited = caffeineSection(render(report));
  assert.match(edited, /교사가 고친 가짜 관찰/);
  assert.doesNotMatch(edited, /16:00에 카페인을 마시고/);
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
  assert.match(caffeineCard(caffeineSection(html), 'drink'), /&lt;img onerror/);
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
  assert.match(html, /data-row="bedtime"[\s\S]*?data-date="2026-11-05"[^>]*>기록 없음<\/span>/);
  assert.match(html, /data-daily-goal="range"[^>]*>[\s\S]*?data-date="2026-11-05" class="summary-mark missing">기록 없음<\/span>/);
  assert.doesNotMatch(html, /summary-mark-hours">/);
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

test('reports unrecorded sleep without treating held or incomplete records as unrecorded', () => {
  const input = makeSummaryFixture();
  const caffeine = input.feedback.engine.findings.find(x => x.id === 'caffeineSummary').data.days;
  caffeine.filter(x => x.date < input.end).forEach(x => { x.recorded = true; });
  const sleep = input.feedback.engine.findings.find(x => x.id === 'bedtimeSeries').data.days;
  Object.assign(sleep[0], { recorded: false, hours: null, bed: null, wake: null, condition: null });
  Object.assign(sleep[1], { recorded: true, held: true, hours: null, bed: null, wake: null, condition: null });
  const html = render(input);
  const review = html.match(/data-summary-text="recordReview"[^>]*>(.*?)<\/div>/s)[1];
  assert.match(review, /수면 기록이 비어 있는 밤은 1일이에요 \(10\.30\)\./);
  assert.doesNotMatch(review, /보류|컨디션|10\.31|11\.04|카페인 기록이 없는/);
  const range = html.match(/data-daily-goal="range"[^>]*>([\s\S]*?)<\/span><\/div>/)[1];
  assert.match(range, /data-date="2026-10-30" class="summary-mark missing">기록 없음/);
  assert.match(range, /data-date="2026-10-31" class="summary-mark none">–/);
  assert.doesNotMatch(review, /표시할 아쉬운 점이 없어요/);
});

test('lists up to three dates for each unrecorded type and counts the remaining days', () => {
  const input = makeSummaryFixture({ length:14, editDays(days) {
    for (const day of days.slice(0, 5)) { delete day.sleep; delete day.caffeine; }
    for (const day of days.slice(5)) day.caffeine = { recorded:true, totalMg:0, intakes:[] };
    for (const day of days.slice(5, 9)) day.sleep.held = true;
    for (const day of days.slice(9)) day.sleep.condition = null;
  } });
  const review = render(input).match(/data-summary-text="recordReview"[^>]*>(.*?)<\/div>/s)[1];
  assert.match(review, /수면 기록이 비어 있는 밤은 5일이에요 \(10\.23, 10\.24, 10\.25 외 2일\)\./);
  assert.match(review, /카페인 기록이 없는 날은 5일이에요 \(10\.23, 10\.24, 10\.25 외 2일\)\./);
  assert.doesNotMatch(review, /10\.26|10\.27|10\.31|11\.04/);
});

test('calculates KST save delays without listing them in the report review', () => {
  const report = makeSummaryFixture({ editDays(days) {
    days[1].caffeine.intakes[0].enteredAt = '2026-11-02 10:00:00';
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
    { kind: 'caffeine', date: '2026-10-31', delayDays: 2, count: 1 },
    { kind: 'caffeine', date: '2026-11-01', delayDays: 1, count: 1 },
    { kind: 'sleep', date: '2026-11-02', delayDays: 1, count: 1 },
  ]);
  assert.doesNotMatch(render(report), /입력했어요|저장 시각 기준|data-late="true"/);
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

test('reports only confirmed daily caffeine totals above the maximum, independent of personal goals', () => {
  const editDays = days => {
    [160,170,171,220,200,180,190,210].forEach((mg,i) => {
      const intakes = [{ mg, time:'14:00', drink:'가상 차' }];
      if (i === 5) intakes.push({ mg:null, time:'16:00', drink:'가상 커피' });
      days[i].caffeine = { recorded:true, totalMg:mg, intakes };
    });
  };
  const review = report => render(report).match(/data-summary-text="recordReview"[^>]*>(.*?)<\/div>/s)[1];
  assert.equal(review(reportWithLimit('weight',170,{length:9,editDays})),
    '<p>일일 최대 섭취량(170mg)을 넘긴 날은 5일이에요 (10.30, 10.31, 11.01 외 2일).</p>');
  assert.doesNotMatch(review(reportWithLimit('noWeight',150,{length:9,editDays})), /섭취량.*넘긴/);
});

test('adds a recorded overlap only when it occurred on at least two missed nights', () => {
  const makeMissedNights = days => {
    days[0].sleep.hours = 11.1;
    days[4].sleep.hours = 7.2;
    days[5].sleep.hours = 7.4;
  };
  const normal = makeSummaryFixture({ editDays: makeMissedNights });
  assert.match(normal.feedback.engine.summaryReflection.rule.difficulty, /4일 중 3일은 자기 전 스마트폰을 30분 이상/);
  const sparse = makeSummaryFixture({ editDays(days) {
    makeMissedNights(days);
    days.forEach((day, i) => {
      day.habits.phone = i === 2 ? '60분 이상' : null;
      day.caffeine?.intakes.forEach(item => { item.time = i === 2 ? '17:30' : '12:00'; });
    });
  } });
  assert.equal(sparse.feedback.engine.summaryReflection.facts.difficulty.observation, null);
  assert.doesNotMatch(sparse.feedback.engine.summaryReflection.rule.difficulty, /스마트폰|오후 3시/);
});

test('AI writes feedback and report narration from anonymous aggregates for single and batch results', async () => {
  const { createTeacherOpenAI } = await import('../vercel/api/_lib/teacher-openai.js');
  const report = makeSummaryFixture();
  const makeData = (n = 1) => structuredClone({ success:true, reports:Array.from({length:n}, (_,i) =>
    ({ ...structuredClone(report), studentId:'synthetic-only-'+i, analysis:'규칙 기반 피드백' })) });
  const original = report.feedback.engine.summaryReflection.rule;
  const comment = '기록에서 보인 차이는 다음 기간에도 함께 살펴볼 만해요.';
  const plan = '잠자리에 들기 편한 시각을 미리 정하고 다음 기록에 남겨 봐요.';
  const memo = '기록에서 찾은 잘된 습관을 다음에도 이어 가 봐요.';
  const respond = value => Response.json({ status:'completed', output:[
    { type:'message', content:[{ type:'output_text', text:JSON.stringify(value) }] },
  ] });
  const rewrite = ({body}, modify = analysis => analysis) => {
    const request = JSON.parse(body);
    assert.equal(request.store,false);
    assert.equal(request.text.format.name,'teacher_report_writing');
    assert.doesNotMatch(request.input,/synthetic-only|테스트 학생|가상|2026-|11\.01|하루 150mg|enteredAt|studentId/);
    const reports = JSON.parse(request.input);
    assert.match(reports[0].caffeineSleep,/카페인.*평균/);
    const analyses = reports.map((facts,i) => modify({
      ...Object.fromEntries(Object.keys(facts).map(field=>[field,facts[field] ? ({ plan,memo })[field] || comment : null])),
      highlights:['caffeineSleep','caffeineDays'],
    },i));
    return respond({analyses});
  };
  for (const n of [1,2]) {
    const result = await createTeacherOpenAI({ readKey:()=> 'fixture-only', fetchImpl:async (_url,options)=>rewrite(options) })(makeData(n));
    for (const item of result.reports) {
      assert.equal(item.feedback.mode,'ai');
      assert.equal(item.feedback.aiFallback,false);
      assert.equal(item.feedback.aiApiStatus,'applied');
      assert.match(files.aiCallStatusText(item.feedback),/API 키 사용 확인.*AI 응답 반영/);
      assert.match(item.analysis,/AI가 살펴본 기록[\s\S]*?기록에서 보인 차이/);
      assert.ok(item.feedback.sections.some(section=>section.items.some(text=>text.includes(comment))));
      assert.match(item.feedback.sections.find(section=>section.id==='record').items[0],/기록에서 보인 차이/);
      assert.deepEqual(item.feedback.sections.find(section=>section.id==='action').items,[plan]);
      assert.equal(item.feedback.summaryReflection.plan,plan);
      assert.equal(item.feedback.sections.some(section=>section.id==='why'),false);
      const html = render(item);
      assert.doesNotMatch(html,/API 키 사용 확인/);
      assert.match(html,/data-summary-text="caffeineSleep"[^>]*>[^<]*기록에서 보인 차이/);
      assert.match(html,/data-summary-text="praise"[^>]*>[^<]*기록에서 보인 차이/);
      assert.match(html,/data-summary-text="plan"[^>]*>[^<]*잠자리에 들기 편한 시각/);
      assert.match(html,/data-summary-text="memo">기록에서 찾은 잘된 습관을 다음에도 이어 가 봐요\.<\/p>/);
      assert.deepEqual(item.feedback.engine.findings,makeData().reports[0].feedback.engine.findings);
      item.feedback.savedPdfFeedback = {summary:'이전에 저장한 한마디'};
      assert.match(render(item),/data-summary-text="memo">이전에 저장한 한마디<\/p>/);
      item.feedback.summaryEdit = {caffeineSleep:'교사가 저장한 설명',memo:'직접 고친 한마디'};
      assert.match(render(item),/data-summary-text="memo">직접 고친 한마디<\/p>/);
      item.feedback.summaryEdit.memo = '';
      assert.match(render(item),/data-summary-text="memo"><\/p>/);
      assert.match(render(item), /data-summary-text="caffeineSleep"[^>]*>교사가 저장한 설명/);
    }
  }
  const calls = [];
  const repairedDifficulty = '목표에 맞지 않은 날의 기록도 다음 계획에 참고해 봐요.';
  const mixed = await createTeacherOpenAI({ readKey:()=> 'fixture-only',
    fetchImpl:async (url,options)=>{
      assert.equal(url,'https://api.openai.com/v1/responses');
      const request = JSON.parse(options.body);
      assert.match(request.model,/^gpt-/);
      calls.push(JSON.parse(request.input).length);
      return rewrite(options,(value,i)=>calls.length === 1 && i === 1 ? {...value, difficulty:'진단: 99시간'}
        : calls.length === 2 ? {...value, praise:'숫자 99를 썼어요.', difficulty:repairedDifficulty} : value);
    },
  })(makeData(2));
  assert.deepEqual(calls,[2,1]);
  assert.deepEqual(mixed.reports.map(item=>item.feedback.mode),['ai','ai']);
  assert.deepEqual(mixed.reports.map(item=>item.feedback.aiApiStatus),['applied','applied']);
  assert.equal(mixed.reports[1].feedback.aiResponseIssue,undefined);
  assert.ok(mixed.reports[1].feedback.summaryReflection.difficulty.includes(repairedDifficulty));
  assert.match(mixed.reports[1].feedback.summaryReflection.praise,/기록에서 보인 차이/);
  assert.match(files.aiCallStatusText(mixed.reports[1].feedback),/GPT.*AI 응답 반영/);
  assert.doesNotMatch(render(mixed.reports[1]),/진단|99시간|API 키 사용 확인/);
  const rejected = await createTeacherOpenAI({ readKey:()=> 'fixture-only',
    fetchImpl:async (_url,options)=>rewrite(options,value=>({...value, difficulty:'새 숫자 99를 넣었어요.'})),
  })(makeData());
  assert.equal(rejected.reports[0].feedback.aiApiStatus,'response_rejected');
  assert.equal(rejected.reports[0].feedback.aiResponseIssue,'wording');
  assert.equal(rejected.reports[0].analysis,'규칙 기반 피드백');
  assert.equal(rejected.reports[0].feedback.aiNarrative,undefined);
  assert.deepEqual(rejected.reports[0].feedback.summaryReflection,structuredClone(original));
  const badResponses = [
    [{status:'incomplete', output:[]}, 'incomplete'],
    [{status:'completed', output:[{type:'message',content:[{type:'refusal'}]}]}, 'refusal'],
    [{status:'completed', output:[]}, 'format'],
  ];
  for (const [body,reason] of badResponses) {
    const result = await createTeacherOpenAI({ readKey:()=> 'fixture-only', fetchImpl:async()=>Response.json(body) })(makeData());
    assert.equal(result.reports[0].feedback.aiApiStatus,'response_rejected');
    assert.equal(result.reports[0].feedback.aiResponseIssue,reason);
    assert.equal(result.reports[0].feedback.mode,'rule');
  }
  const offline = await createTeacherOpenAI({ readKey:()=> 'fixture-only', fetchImpl:async()=>{throw Error('offline');} })(makeData());
  assert.equal(offline.reports[0].feedback.aiFallback,true);
  assert.equal(offline.reports[0].feedback.aiApiStatus,'request_failed');
  assert.deepEqual(offline.reports[0].feedback.summaryReflection,structuredClone(original));
  const unauthorized = await createTeacherOpenAI({ readKey:()=> 'fixture-only', fetchImpl:async()=>new Response(null,{status:401}) })(makeData());
  assert.equal(unauthorized.reports[0].feedback.aiApiStatus,'authentication_failed');
  let notSentCalls = 0;
  const unused = async()=>{ notSentCalls++; throw Error('Unexpected API call'); };
  const missing = await createTeacherOpenAI({ readKey:()=> '', fetchImpl:unused })(makeData());
  assert.equal(missing.reports[0].feedback.aiApiStatus,'missing_key');
  const empty = {success:true,reports:[makeSummaryFixture({empty:true})]};
  const noFacts = await createTeacherOpenAI({ readKey:()=> 'fixture-only', fetchImpl:unused })(empty);
  assert.equal(noFacts.reports[0].feedback.aiApiStatus,'no_facts');
  assert.equal(notSentCalls,0);
  assert.match(files.aiCallStatusText({mode:'rule'}),/호출 안 함/);
  assert.match(files.aiCallStatusText({mode:'rule',aiFallback:true}),/확인할 수 없음/);
  assert.match(files.aiCallStatusText({aiApiStatus:'preview'}),/실제 API 호출 없음/);
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
