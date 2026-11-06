const REPORT_FIELDS = ['caffeineSleep', 'behavior', 'caffeineDays', 'sleepHabits'];
const REFLECTION_FIELDS = ['praise', 'difficulty', 'plan'];
const FIELDS = [...REPORT_FIELDS, ...REFLECTION_FIELDS, 'memo'];
const HIGHLIGHTS = [...REPORT_FIELDS, 'praise', 'difficulty'];
const GOAL_LABELS = {
  caffeineMax: '카페인 섭취량 목표', bedtime: '취침시각 목표', sleepMin: '수면시간 목표',
  wakeTime: '기상시각 목표', phone: '자기 전 스마트폰 목표', activity: '신체활동 목표',
  range: '권장 수면시간 기준', other: '기록으로 확인한 목표',
  sleepRecords: '수면 기록', caffeineRecords: '카페인 기록',
};
const PLAN_TOPICS = {
  recordedBedtime: '기록에서 지켰던 취침시각에 맞춰 미리 준비하기',
  recordedCaffeine: '기록에서 지켰던 카페인 섭취 습관 다시 해 보기',
  recordedWake: '기록에서 지켰던 기상시각에 맞춰 일어나 보기',
  recordedPhone: '자기 전 스마트폰 사용 습관 이어 가기',
  recordedActivity: '기록에서 실천했던 신체활동 이어 가기',
};
const UNSAFE_TEXT = /[\p{N}\p{Extended_Pictographic}\r\n<>@]|https?:|(?:질환|진단|장애|치료|처방|약물|반드시|무조건|확실히|때문|덕분|탓에|유발|원인으로|학생 이름|학번|연구\s*대상자\s*코드)/iu;

function compare(groups, field, labels, unit) {
  const values = groups.map(group => group.map(day => day[field]).filter(Number.isFinite));
  if (values.some(group => group.length < 2)) return null;
  const [first, second] = values.map(group => (group.reduce((sum, value) => sum + value, 0) / group.length).toFixed(1));
  return `${labels[0]}(${values[0].length}일)는 평균 ${first}${unit}, ${labels[1]}(${values[1].length}일)는 평균 ${second}${unit}이었어요.`;
}

function goalEvidence(goal) {
  if (!goal || !Object.hasOwn(GOAL_LABELS, goal.kind) || !Number.isInteger(goal.measured) ||
      !Number.isInteger(goal.kept) || goal.measured < 1 || goal.measured > 366 || goal.kept < 0 || goal.kept > goal.measured) return null;
  const label = GOAL_LABELS[goal.kind];
  if (goal.kind === 'sleepRecords' || goal.kind === 'caffeineRecords') return `${label}을 ${goal.measured}일 중 ${goal.kept}일 남겼어요.`;
  const observation = goal.observation;
  const observed = observation?.kind === 'phone30' ? '자기 전 스마트폰을 30분 이상 썼다고 적었어요.' :
    observation?.kind === 'afternoonCaffeine' ? '오후 3시 이후 카페인을 마셨다고 적었어요.' : '';
  const overlap = observed && Number.isInteger(observation.count) && observation.count >= 2 && observation.count <= goal.measured - goal.kept
    ? ` 지키지 못한 날 중 ${observation.count}일은 ${observed}` : '';
  return `확인 가능한 ${goal.measured}일 중 ${goal.kept}일에 ${label}에 맞는 기록을 남겼어요.${overlap}`;
}

function buildEvidence(engine) {
  const finding = id => engine.findings?.find(item => item.id === id)?.data;
  const sleep = (finding('bedtimeSeries')?.days || []).filter(day => !day.open && day.recorded && !day.held);
  const caffeine = finding('caffeineSummary')?.days || [];
  const caffeineByDate = new Map(caffeine.map(day => [day.date, day.status]));
  const caffeineGroups = ['known', 'zero'].map(status => sleep.filter(day => caffeineByDate.get(day.date) === status));
  const caffeineLabels = ['카페인을 마신 날의 수면시간', '안 마신 날의 수면시간'];
  const caffeineSleep = compare(caffeineGroups, 'hours', caffeineLabels, '시간') ||
    compare(caffeineGroups, 'condition', ['카페인을 마신 날의 다음 날 아침 컨디션', '안 마신 날의 다음 날 아침 컨디션'], '점');
  const hasHours = sleep.filter(day => Number.isFinite(day.hours));
  const inRange = day => day.hours >= 8 && day.hours <= 10;
  const behavior = compare([hasHours.filter(inRange), hasHours.filter(day => !inRange(day))], 'condition',
    ['수면시간이 8~10시간인 밤의 다음 날 컨디션', '그 밖의 밤의 다음 날 컨디션'], '점');
  const intakes = caffeine.flatMap(day => (day.intakes || []).filter(item => item.mg !== 0));
  const timed = intakes.filter(item => Number.isFinite(item.time));
  const late = timed.filter(item => item.time >= 900).length;
  const zero = caffeine.filter(day => day.status === 'zero').length;
  const caffeineDays = intakes.length ? (timed.length
    ? `시각을 기록한 카페인 섭취 ${timed.length}번 중 ${late}번은 오후 3시 이후였어요.`
    : `카페인 섭취를 ${intakes.length}번 기록했어요.`) : zero ? `카페인을 안 마셨다고 기록한 날은 ${zero}일이에요.` : null;
  const phoneGroups = finding('phoneBeforeBed')?.members?.map(dates => new Set(dates));
  const sleepHabits = phoneGroups?.length === 2 ? compare(phoneGroups.map(dates => sleep.filter(day => dates.has(day.date))),
    'hours', ['자기 전 스마트폰을 30분 이상 쓴 밤의 수면시간', '그보다 적게 사용했거나 사용하지 않은 밤의 수면시간'], '시간') : null;
  const { praise, difficulty, plan } = engine.summaryReflection.facts || {};
  const evidence = { caffeineSleep, behavior, caffeineDays, sleepHabits, praise: goalEvidence(praise), difficulty: goalEvidence(difficulty) };
  const planTopic = Object.hasOwn(PLAN_TOPICS, plan?.kind) ? PLAN_TOPICS[plan.kind] : '다음 기간에도 같은 항목을 기록하기';
  const memo = evidence.praise || Object.values(evidence).find(Boolean) || null;
  return { ...evidence, plan: memo ? planTopic : null, memo };
}

function validAnalysis(value, evidence) {
  if (!value || Object.keys(value).length !== FIELDS.length + 1) return false;
  const { highlights } = value;
  if (!Array.isArray(highlights) || highlights.length < 1 || highlights.length > 2 || new Set(highlights).size !== highlights.length ||
      !highlights.every(field => HIGHLIGHTS.includes(field) && evidence[field])) return false;
  return FIELDS.every(field => {
    const sentence = value[field];
    return evidence[field] ? typeof sentence === 'string' && sentence.trim().length >= 8 && sentence.length <= 72 &&
      /[가-힣]/.test(sentence) && !UNSAFE_TEXT.test(sentence) : sentence === null;
  });
}

function useRule(report) {
  const { feedback } = report;
  feedback.mode = 'rule';
  feedback.aiFallback = true;
  if (feedback.engine?.summaryReflection) feedback.summaryReflection = { ...feedback.engine.summaryReflection.rule };
}

function useAnalysis(report, evidence, analysis) {
  const { feedback } = report;
  const write = (fact, sentence) => [fact, sentence?.trim()].filter(Boolean).join(' ');
  feedback.aiNarrative = Object.fromEntries(REPORT_FIELDS.filter(field => evidence[field])
    .map(field => [field, write(evidence[field], analysis[field])]));
  feedback.aiNarrative.memo = analysis.memo.trim();
  const rule = feedback.engine.summaryReflection.rule;
  feedback.summaryReflection = {
    praise: write(rule.praise || evidence.praise, analysis.praise),
    difficulty: write(rule.difficulty || evidence.difficulty, analysis.difficulty),
    plan: write(analysis.plan.trim(), rule.plan),
  };
  const items = analysis.highlights.map(field => write(evidence[field], analysis[field]));
  feedback.sections = [{ id:'aiAnalysis', tone:'sleep', title:'AI가 살펴본 기록', items }, ...feedback.sections.map(section =>
    section.id === 'action' ? { ...section, items:[analysis.plan.trim()] } : section)];
  report.analysis = feedback.sections.map(section => [(section.icon ? section.icon + ' ' : '') + section.title, ...section.items].join('\n')).join('\n\n');
  feedback.mode = 'ai';
  feedback.aiFallback = false;
}

export async function writeTeacherReports(data, { fetchImpl, readKey, model }) {
  const reports = data.reports.filter(report => report.feedback);
  const pending = reports.filter(report => report.feedback.engine?.summaryReflection)
    .map(report => ({ report, evidence:buildEvidence(report.feedback.engine) })).filter(item => item.evidence.plan);
  const key = readKey()?.trim();
  for (const report of reports) report.feedback.aiApiStatus = key ? 'no_facts' : 'missing_key';
  let state = key ? 'report_no_facts' : 'missing_key';
  if (key && pending.length) {
    const groups = [];
    for (let i = 0; i < pending.length; i += 4) groups.push(pending.slice(i,i+4));
    const states = await Promise.all(groups.map(async group => {
      const setApiStatus = status => {
        for (const { report } of group) report.feedback.aiApiStatus = status;
      };
      setApiStatus('request_failed');
      try {
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method:'POST', redirect:'error', signal:AbortSignal.timeout(8000),
          headers:{ Authorization:'Bearer '+key, 'Content-Type':'application/json' },
          body:JSON.stringify({
            model, store:false, max_output_tokens:2400,
            instructions:'Write brief Korean feedback for a school caffeine and sleep log. Each input object has confirmed aggregate evidence for one report. Return one analysis per input, in order. For each non-null evidence field except plan and memo, write one natural 해요체 sentence interpreting the stated pattern. Preserve the direction and scope of comparisons. Describe differences as observations, never as causes. The app displays the exact evidence alongside your sentence. Do not repeat numbers, invent observations, infer identity, diagnose, or give medical advice. For plan write one practical action using only the given plan topic. For memo write one supportive sentence for the teacher to review, grounded in the memo evidence. Recognize the effort the records show. Return null for null inputs. For highlights choose one or two different non-null evidence fields, excluding plan and memo, whose patterns are most useful to point out. Return plain Korean text only, with each sentence no longer than 72 characters.',
            input:JSON.stringify(group.map(item => item.evidence)),
            text:{ format:{ type:'json_schema', name:'teacher_report_writing', strict:true, schema:{
              type:'object', additionalProperties:false, required:['analyses'], properties:{ analyses:{ type:'array', items:{
                type:'object', additionalProperties:false, required:[...FIELDS,'highlights'], properties:{
                  ...Object.fromEntries(FIELDS.map(field => [field,{ type:['string','null'] }])),
                  highlights:{ type:'array', items:{ type:'string', enum:HIGHLIGHTS } },
                },
              } } },
            } } },
          }),
        });
        if (!response.ok) {
          if ([401,403].includes(response.status)) {
            setApiStatus('authentication_failed');
            return 'authentication_failed';
          }
          return 'report_failed';
        }
        setApiStatus('response_rejected');
        const body = await response.json();
        const output = body.output?.flatMap(item => item.type === 'message' ? item.content : [])
          .find(item => item.type === 'output_text')?.text;
        const { analyses } = JSON.parse(output);
        if (body.status !== 'completed' || !Array.isArray(analyses) || analyses.length !== group.length) return 'report_failed';
        group.forEach(({ report, evidence }, i) => {
          if (validAnalysis(analyses[i],evidence)) {
            useAnalysis(report,evidence,analyses[i]);
            report.feedback.aiApiStatus = 'applied';
          }
        });
        return 'report_failed';
      } catch {
        return 'report_failed';
      }
    }));
    state = reports.some(report => report.feedback.aiNarrative) ? 'report_written' : states[0];
  }
  for (const report of reports) if (!report.feedback.aiNarrative) useRule(report);
  return { ...data, aiVerification:{ state } };
}
