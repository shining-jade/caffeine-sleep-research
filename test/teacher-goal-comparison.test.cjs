const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { root, gas, makeSummaryFixture } = require('./fixtures/summary-report.cjs');
const env = vm.createContext({ window: {} });
for (const file of ['teacher-goal-comparison.js', 'teacher-report-files.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'vercel/public/js', file), 'utf8'), env);
}
const goals = env.window.teacherGoalComparison;
const plain = value => JSON.parse(JSON.stringify(value));
const parse = (goal, numeric = {}) => goals.parse({ goal, ...numeric });
const row = (i, values = {}) => ({
  date: '2026-11-' + String(i).padStart(2, '0'), open: false,
  sleep: { hours: 7, bed: 1410, wake: 400, condition: 3 },
  caffeine: { recorded: true, totalMg: 40, times: [960] },
  habits: { phone: '30분 미만', activity: '30~60분' },
  ...values,
});
const set = (n, kept) => Array.from({ length:n }, (_, i) =>
  row(i + 1, { habits:{ phone:i < kept ? '30분 미만' : '60분 이상' } }));
const periods = { baselineStart:'2026-10-26', baselineEnd:'2026-10-31', start:'2026-11-01', end:'2026-11-06' };
const phone = { rules:[{ kind:'phone', value:30, strict:true }], targetDays:4, targetWindow:7, unverified:[] };

test('extracts multiple SMART actions and dates only as durations, prioritizing numeric CSV fields', () => {
  const model = parse('잠들기 전 30분 휴대폰을 쓰지 않고 무음으로 바꿔 책상에 둬요. 하루 카페인 150mg 이하, 밤 11시 전 취침을 7일 중 4일 지켜요.', {
    caffeineMax:80, bedtime:'23:30',
  });
  assert.deepEqual(plain(model.rules).map(({kind,value,strict}) => [kind,value,strict]).sort(), [
    ['bedtime',1410,false], ['caffeineMax',80,false], ['phone',30,true],
  ]);
  assert.equal(model.targetDays,4);
  assert.equal(model.targetWindow,7);
  assert.match(model.unverified.join(' '), /무음.*책상/);
  assert.equal(parse('11월 5일에 물 2잔 마시기').targetDays, null);
  assert.equal(parse('물을 7일 중 4일 마시기').rules.length,0);
  const afternoon = parse('오후 3시 이후 카페인을 마시지 않고, 운동 30분 이상을 4일 실천하기');
  assert.deepEqual(plain(afternoon.rules).map(({kind,value})=>[kind,value]).sort(), [['activity',30],['caffeineAfter',900]]);
});

test('classifies the four evaluations and computes target progress from measurable days only', () => {
  for (const [before,after,expected] of [
    [set(6,2),set(6,4),'잘 해냈어요!'],
    [set(6,1),set(6,3),'한 걸음 나아갔어요.'],
    [set(6,5),set(6,4),'한 걸음 나아갔어요.'],
    [set(6,4),set(6,2),'조금 아쉬웠어요.'],
    [set(1,1),set(6,4),'기록이 조금 더 필요해요.'],
  ]) assert.equal(goals.compare({ periods, model:phone, before, after }).evaluation,expected);
  const after = [...set(4,3), row(5,{open:true}), row(6,{habits:{phone:null}})];
  const comparison = goals.compare({ periods, model:phone, before:set(6,2), after });
  assert.deepEqual(plain(comparison.goals[0].days).slice(-2).map(day=>day.mark), ['아직','–']);
  assert.equal(comparison.goals[0].after.measured,4);
  assert.equal(comparison.goals[0].after.kept,3);
});

test('keeps all caffeine metrics and distinguishes zero, unknown amounts, unknown times and open nights', () => {
  const before = [
    row(1,{caffeine:{recorded:true,totalMg:0,times:[]}}),
    row(2,{caffeine:{recorded:true,totalMg:100,times:[899]}}),
    row(3,{caffeine:{recorded:true,totalMg:null,times:[900]}}),
    row(4,{caffeine:{recorded:true,totalMg:50,times:[null]}}),
    row(5,{caffeine:{recorded:false,totalMg:null,times:[]}}),
  ];
  const after = [row(6,{caffeine:{recorded:true,totalMg:0,times:[]}}),row(7,{open:true,caffeine:{recorded:true,totalMg:20,times:[900]}})];
  const result = goals.compare({ periods, before, after });
  assert.equal(result.model,null);
  assert.equal(result.evaluation,'좋아졌어요');
  const metrics = Object.fromEntries(result.metrics.map(metric => [metric.key,metric]));
  assert.deepEqual(plain(metrics.caffeine.before), { n:3, value:50 });
  assert.deepEqual(plain(metrics.caffeine.after), { n:2, value:10 });
  assert.deepEqual(plain(metrics.drinking.before), { n:4, value:.75, count:3 });
  assert.deepEqual(plain(metrics.late.before), { n:3, value:1/3, count:1 });
  assert.equal(metrics.sleep.comparable,false);
  const early = goals.compare({ periods, before, after, model:{ ...phone, rules:[{kind:'caffeineAfter',value:900,strict:false}] } });
  assert.deepEqual(plain(early.goals[0].before), { kept:2, measured:3 });
});

test('renders the approved goal report on page one, with the existing page two unchanged', () => {
  const report = makeSummaryFixture();
  const original = env.window.teacherReportFiles.buildSummaryReportDocument(report).content;
  report.goalComparison = goals.compare({ periods, model:{ ...phone, text:'<img onerror=alert(1)>', unverified:['무음 설정'] }, before:set(6,2), after:set(6,4) });
  const html = env.window.teacherReportFiles.buildSummaryReportDocument(report).content;
  assert.match(html, /한 줄 정리[\s\S]*?잘 해냈어요![\s\S]*?① 내 목표[\s\S]*?② 같은 기준으로 본 전후[\s\S]*?③ 수면과 카페인도 함께 보기[\s\S]*?④ 돌아보기/);
  assert.match(html, /&lt;img onerror/);
  assert.match(html, /기록으로 확인할 수 없는 부분[\s\S]*?무음 설정/);
  assert.equal(html.split('<article class="summary-page" data-page="2"')[1],original.split('<article class="summary-page" data-page="2"')[1]);
  const noGoal = goals.compare({ periods, before:set(1,1), after:set(6,4) });
  assert.doesNotMatch(goals.renderPage(noGoal,'테스트 학생'), /① 내 목표/);
  assert.match(goals.renderPage(noGoal,'테스트 학생'), /비교 보류/);
});

test('falls back to the rule interpretation on invalid AI output and keeps CSV overrides', () => {
  const goal = { goal:'카페인 150mg 이하 7일 중 4일', caffeineMax:80 };
  assert.deepEqual(plain(goals.interpret(goal,{ rules:[{kind:'bad',value:150,strict:false}], targetDays:4, targetWindow:7, unverified:[] })),plain(goals.parse(goal)));
  const ai = goals.interpret(goal,{rules:[{kind:'caffeineMax',value:200,strict:false}],targetDays:4,targetWindow:7,unverified:[]});
  assert.equal(ai.rules[0].value,80);
});

test('chooses the applicable class dates and starts the baseline at the first record', () => {
  const classGoal = { start:'2026-11-01',end:'2026-11-07',goal:'수면 8시간 이상',sleepMin:8 };
  const other = { start:'2026-10-01',end:'2026-10-07',goal:'가상 이전 목표' };
  const actual = gas.teacherGoalComparisonPeriods_('2026-11-02','2026-11-05',[other,classGoal],'2026-09-03');
  assert.deepEqual(plain(actual), { start:classGoal.start,end:classGoal.end,goal:classGoal,
    baselineStart:'2026-09-03',baselineEnd:'2026-10-31' });
  assert.deepEqual(plain(gas.teacherGoalComparisonPeriods_('2026-11-02','2026-11-05',[],'2026-11-02')),
    { start:'2026-11-02',end:'2026-11-05',goal:null,baselineStart:null,baselineEnd:null });
});

test('removes known identifiers and calendar dates from the optional AI sentence', () => {
  const redacted = gas.teacherGoalSafeSentence_(
    '가상학생 학번 12345 연구대상자코드 STUDY-A9 2026-11-05와 11월 6일, 11/07. 오후 3시 이후 0잔을 7일 중 4일 지키기',
    {name:'가상학생',id:'12345',dashboardId:'12345_가상학생',researchCode:'STUDY-A9'});
  assert.doesNotMatch(redacted,/가상학생|12345|STUDY|2026|11월|11\/07/);
  assert.match(redacted,/오후 3시 이후 0잔을 7일 중 4일/);
});

test('the optional AI request contains only the sanitized sentence and returns null on failure', async () => {
  const { createTeacherGoalInterpreter } = await import('../vercel/api/_lib/teacher-openai.js');
  const sentence = '오후 3시 이후 카페인을 마시지 않기를 7일 중 4일 지키기';
  const model = {rules:[{kind:'caffeineAfter',value:900,strict:false}],targetDays:4,targetWindow:7,unverified:[]};
  const interpret = createTeacherGoalInterpreter({ readKey:()=> 'fixture-only', fetchImpl:async (_url,options)=>{
    const request = JSON.parse(options.body);
    assert.equal(request.input,sentence);
    assert.equal(request.store,false);
    return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(model)}]}]}));
  } });
  assert.deepEqual(await interpret(sentence),model);
  assert.equal(await interpret('2026-11-05 학번 1234 '+sentence),null);
  const failed = createTeacherGoalInterpreter({readKey:()=> 'fixture-only', fetchImpl:async()=>{throw Error('offline');}});
  assert.equal(await failed(sentence),null);
});

test('resolves and generates comparison through the teacher action with owned synthetic records', () => {
  const { goalFixture } = require('./fixtures/goal-comparison.cjs');
  for (const withGoal of [true,false]) {
    const fixture = goalFixture(withGoal);
    const input = { reportVersion:2,mode:'rule',start:fixture.start,end:fixture.end,
      students:[{studentId:'0',studentName:'테스트 학생',limit:150,limitBasis:'fixed'}] };
    const setup = fixture.request({...input,goalComparison:{phase:'setup'}});
    assert.equal(setup.firstRecordDate,'2026-10-23');
    assert.equal(setup.periods.start,'2026-10-30');
    assert.equal(setup.periods.baselineStart,'2026-10-23');
    assert.equal(Boolean(setup.goal),withGoal);
    assert.equal(setup.after,undefined);
    const options = {phase:'report',practiceStart:setup.periods.start,practiceEnd:setup.periods.end,
      baselineStart:'2026-10-24',baselineEnd:'2026-10-28',revision:setup.goal?.revision};
    const data = fixture.request({...input,goalComparison:options});
    assert.equal(data.before.length,5);
    assert.equal(data.after.length,7);
    assert.equal(data.after.at(-1).open,true);
    assert.equal(data.after[0].sleep.hours,8);
    assert.ok(data.before.some(day=>day.caffeine.totalMg===0));
    assert.ok(data.feedback.engine.summaryReflection);
    assert.throws(()=>fixture.request({...input,goalComparison:{...options,baselineEnd:'2026-10-30'}}),/시작 전날/);
  }
});

test('distinguishes a known target achievement from a withheld baseline comparison', () => {
  const result = goals.compare({ periods, model:phone,before:set(1,1),after:set(6,4) });
  assert.equal(result.evaluation,'기록이 조금 더 필요해요.');
  assert.equal(result.comparable,false);
  assert.equal(result.achieved,true);
  const same = goals.compare({ periods,before:set(6,4),after:set(6,4) });
  assert.equal(same.evaluation,'조금 아쉬웠어요');
  assert.match(same.summary,/거의 그대로/);
  const tooLong = goals.compare({ periods,before:[row(1),row(2)],after:[
    row(3,{sleep:{hours:13,bed:1410,wake:400,condition:3}}),
    row(4,{sleep:{hours:13,bed:1410,wake:400,condition:3}}),
  ] });
  assert.equal(tooLong.evaluation,'조금 아쉬웠어요');
});

test('connects the two period values and reports exact changes across midnight and for rates', () => {
  const before = set(6,2).map(day=>({...day,sleep:{...day.sleep,bed:1430},
    caffeine:{recorded:true,totalMg:0,times:[]}}));
  const after = set(6,4).map(day=>({...day,sleep:{...day.sleep,bed:1450},
    caffeine:{recorded:true,totalMg:50,times:[900]}}));
  const html = goals.renderPage(goals.compare({ periods,model:phone,before,after }),'테스트 학생');
  assert.match(html, /목표 실천율[\s\S]*?33\.3%[\s\S]*?66\.7%/);
  const lines = html.match(/<tr><th scope="row"[^>]*>.*?<\/tr>/gs);
  const bed = lines.find(line=>line.includes('평균 취침시각'));
  assert.match(bed, /23:50[\s\S]*?goal-compare-slope[\s\S]*?y1="24"[\s\S]*?y2="4"[\s\S]*?00:10[\s\S]*?20분 늦어짐/);
  const caffeine = lines.find(line=>line.includes('하루 평균 카페인'));
  assert.match(caffeine, /0\.0mg[\s\S]*?goal-compare-slope[\s\S]*?50\.0mg[\s\S]*?50mg 증가/);
  assert.match(lines.find(line=>line.includes('오후 3시 이후 마신 날')), /100%p 증가/);
  assert.match(lines.find(line=>line.includes('평균 수면시간')), /y1="14"[\s\S]*?y2="14"[\s\S]*?변화 없음/);
  const withheld = goals.renderPage(goals.compare({ periods,model:phone,before:before.slice(0,1),after }),'테스트 학생');
  assert.match(withheld, /비교 보류/);
  assert.doesNotMatch(withheld, /class="goal-compare-(?:track|slope)/);
});
