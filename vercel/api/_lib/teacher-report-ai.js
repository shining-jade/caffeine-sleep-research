const REPORT_FIELDS = ['caffeineSleep', 'behavior', 'caffeineDays', 'sleepHabits'];
const REFLECTION_FIELDS = ['praise', 'difficulty', 'plan'];
const FIELDS = ['record', ...REPORT_FIELDS, ...REFLECTION_FIELDS, 'memo'];
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
  return `${labels[0]}은 평균 ${first}${unit}(${values[0].length}일), ${labels[1]}은 평균 ${second}${unit}(${values[1].length}일)입니다.`;
}

function goalEvidence(goal) {
  if (!goal || !Object.hasOwn(GOAL_LABELS, goal.kind) || !Number.isInteger(goal.measured) ||
      !Number.isInteger(goal.kept) || goal.measured < 1 || goal.measured > 366 || goal.kept < 0 || goal.kept > goal.measured) return null;
  const label = GOAL_LABELS[goal.kind];
  if (goal.kind === 'sleepRecords' || goal.kind === 'caffeineRecords') return `${label}을 ${goal.measured}일 중 ${goal.kept}일 남겼습니다.`;
  const observation = goal.observation;
  const observed = observation?.kind === 'phone30' ? '자기 전 스마트폰을 30분 이상 사용했다고 기록했습니다.' :
    observation?.kind === 'afternoonCaffeine' ? '오후 3시 이후 카페인을 섭취했다고 기록했습니다.' : '';
  const overlap = observed && Number.isInteger(observation.count) && observation.count >= 2 && observation.count <= goal.measured - goal.kept
    ? ` 지키지 못한 날 중 ${observation.count}일은 ${observed}` : '';
  return `확인 가능한 ${goal.measured}일 중 ${goal.kept}일은 ${label}에 맞았습니다.${overlap}`;
}

function buildEvidence({ engine, reportMode }) {
  const finding = id => engine.findings?.find(item => item.id === id)?.data;
  const habit = finding('recordHabit');
  const record = Number.isInteger(habit?.count) && habit.count > 0
    ? `수면이나 카페인 기록을 ${habit.count}일 남겼습니다.${habit.streak > 1 ? ` 가장 긴 연속 기록은 ${habit.streak}일입니다.` : ''}` : null;
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
    ? `시각을 기록한 카페인 섭취 ${timed.length}번 중 ${late}번은 오후 3시 이후였습니다.`
    : `카페인 섭취를 ${intakes.length}번 기록했습니다.`) : zero ? `카페인을 안 마셨다고 기록한 날은 ${zero}일입니다.` : null;
  const phoneGroups = finding('phoneBeforeBed')?.members?.map(dates => new Set(dates));
  const sleepHabits = phoneGroups?.length === 2 ? compare(phoneGroups.map(dates => sleep.filter(day => dates.has(day.date))),
    'hours', ['자기 전 스마트폰을 30분 이상 쓴 밤의 수면시간', '그보다 적게 사용했거나 사용하지 않은 밤의 수면시간'], '시간') : null;
  const { praise, difficulty, plan } = engine.summaryReflection.facts || {};
  const evidence = { record, caffeineSleep, behavior, caffeineDays, sleepHabits, praise: goalEvidence(praise), difficulty: goalEvidence(difficulty) };
  const planTopic = Object.hasOwn(PLAN_TOPICS, plan?.kind) ? PLAN_TOPICS[plan.kind] : '다음 기간에도 같은 항목을 기록하기';
  const memoEvidence = evidence.praise || Object.values(evidence).find(Boolean) || null;
  const isFinal = (reportMode ?? engine.mode) === 'final';
  const memo = memoEvidence && (isFinal ? '연구 종료 후 마무리 분석입니다. ' + memoEvidence : memoEvidence);
  return { ...evidence, plan: memo ? planTopic : null, memo };
}

function acceptedAnalysis(value, evidence) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sentences = {};
  for (const field of FIELDS.filter(field => evidence[field])) {
    if (typeof value[field] !== 'string') continue;
    const sentence = value[field].trim();
    if (sentence.length < 8 || sentence.length > 72 || UNSAFE_TEXT.test(sentence)) continue;
    if (field === 'memo') {
      if (!/(?:요|니다)[.!?]$/.test(sentence) || /감사|고맙|고마|(?:격려|칭찬)(?:합니다|해요)/.test(sentence)) continue;
    } else if (!/(?:니다|십시오)[.!?]$/.test(sentence) || /요[.!?](?:\s|$)/.test(sentence)) continue;
    sentences[field] = sentence;
  }
  const highlights = Array.isArray(value.highlights)
    ? [...new Set(value.highlights.filter(field => HIGHLIGHTS.includes(field) && evidence[field]))].slice(0, 2) : [];
  return { sentences, highlights };
}

function useRule(report) {
  const { feedback } = report;
  feedback.mode = 'rule';
  feedback.aiFallback = true;
  if (feedback.engine?.summaryReflection) feedback.summaryReflection = { ...feedback.engine.summaryReflection.rule };
}

function useAnalysis(report, evidence, { sentences, highlights }) {
  const { feedback } = report;
  const write = (fact, sentence) => [fact, sentence].filter(Boolean).join(' ');
  feedback.aiNarrative = Object.fromEntries(REPORT_FIELDS.filter(field => sentences[field])
    .map(field => [field, write(evidence[field], sentences[field])]));
  if (sentences.memo) feedback.aiNarrative.memo = sentences.memo;
  const rule = feedback.engine.summaryReflection.rule;
  feedback.summaryReflection = {
    praise: sentences.praise ? write(rule.praise || evidence.praise, sentences.praise) : rule.praise,
    difficulty: sentences.difficulty ? write(rule.difficulty || evidence.difficulty, sentences.difficulty) : rule.difficulty,
    plan: sentences.plan,
  };
  const actionTitle = feedback.sections.find(section => section.id === 'action')?.title || '이번 주 해 볼 것';
  const goalItems = ['praise', 'difficulty'].filter(field => {
    const kind = feedback.engine.summaryReflection.facts?.[field]?.kind;
    return sentences[field] && !highlights.includes(field) && kind && kind !== 'sleepRecords' && kind !== 'caffeineRecords';
  }).map(field => feedback.summaryReflection[field]);
  feedback.sections = [
    ...(sentences.record ? [{ id:'record', title:'📝 기록 습관', items:[write(evidence.record, sentences.record)] }] : []),
    ...(goalItems.length ? [{ id:'goals', tone:'goal', title:'🎯 내 목표', items:goalItems }] : []),
    ...(highlights.length ? [{ id:'findings', tone:'sleep', title:'AI가 살펴본 기록',
      items:highlights.map(field => write(evidence[field], sentences[field])) }] : []),
    { id:'action', tone:'next', title:actionTitle, items:[sentences.plan] },
  ];
  feedback.sources = [];
  report.analysis = feedback.sections.map(section => [(section.icon ? section.icon + ' ' : '') + section.title, ...section.items].join('\n')).join('\n\n');
  feedback.mode = 'ai';
  feedback.aiFallback = false;
  feedback.aiApiStatus = 'applied';
  delete feedback.aiResponseIssue;
}

const INSTRUCTIONS = 'Write Korean feedback for a school caffeine and sleep log using only the supplied aggregate evidence. Return one analysis per input, in order. For each non-null field except memo, write one natural Korean sentence in formal 합니다체 for a teacher report, using 8 to 72 characters. End with a form such as 나타났습니다, 확인됩니다, or 권합니다. Use clear, natural Korean without exclamations, stiff filler such as 모습이 확인됩니다, or a paraphrase of the figures already shown. Prefer concrete verbs. Write 기준을 벗어난 날 instead of 일부 날 when describing missed days. In comparisons name both groups when useful and describe only the direction supported by the evidence. For difficulty, distinguish meeting a range from being below it: if the evidence only says a target was missed, do not infer why or which side of the range. Return null only when the corresponding input field is null. For record, always acknowledge the act of keeping records when evidence is supplied, even if it only supports one brief observation. Mention consistency only when the record supports it. Interpret observations without changing their direction or scope, and never suggest that one observation caused another. The app displays the original figures separately: omit all numerals, dates, times, thresholds, scores and amounts from your sentences, even if they appear in the input. Do not add facts, names, diagnoses, medical advice, links or emojis. Use the plan topic for one practical recommendation, phrased naturally with 하는 것을 권합니다 when appropriate. For memo only, write a brief, friendly note addressed directly to the student in one or two short Korean sentences, 8 to 72 characters in total. Choose polite 해요체 or 합니다체 according to the message. You may combine them naturally, for example a factual observation in 했습니다 followed by encouragement in 해 봐요. Do not force a mix or switch register within a sentence. Use only memo evidence to acknowledge a specific effort and encourage the student to continue that habit. Do not describe any habit as effective or beneficial unless the memo evidence establishes it. For final reviews marked 연구 종료 후 마무리 분석, recognize the effort across the study and encourage continuation after the study, without assuming further study records. Do not thank the student or use phrases such as 감사합니다, 고마워요, 격려합니다, or 칭찬합니다. When supported by the record, a natural note is 카페인 섭취 목표를 꾸준히 지켰습니다. 자신에게 맞았던 방법을 이어 가 봐요. For highlights choose one or two distinct available fields from caffeineSleep, behavior, caffeineDays, sleepHabits, praise and difficulty, or return an empty list if none of them are available.';

async function requestDrafts(group, { fetchImpl, key, model }, retry) {
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(retry ? 6500 : 8000),
      headers:{ Authorization:'Bearer '+key, 'Content-Type':'application/json' },
      body:JSON.stringify({
        model, store:false, max_output_tokens:2400,
        ...(model.startsWith('gpt-6') ? { reasoning:{ effort:'none' } } : {}),
        instructions:INSTRUCTIONS + (retry ? ' This is a second attempt. Check that every non-null field uses the requested tone (합니다체 for analysis, and natural 해요체, 합니다체, or both for memo), contains no digits, and uses only supported evidence. Return the complete requested analysis.' : ''),
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
      const status = response.status === 404 ? 'model_unavailable'
        : [401,403].includes(response.status) ? 'authentication_failed' : 'request_failed';
      return { status };
    }
    const body = await response.json().catch(() => null);
    const modelUsed = typeof body?.model === 'string' && /^gpt-[a-z0-9.-]{1,63}$/i.test(body.model) ? body.model : undefined;
    const reply = { status:'response_rejected', modelUsed };
    const messages = Array.isArray(body?.output) ? body.output.flatMap(item =>
      item?.type === 'message' && Array.isArray(item.content) ? item.content : []) : [];
    if (messages.some(item => item?.type === 'refusal')) return { ...reply, issue:'refusal' };
    if (body?.status === 'incomplete') return { ...reply, issue:'incomplete' };
    const output = messages.find(item => item?.type === 'output_text')?.text;
    if (body?.status === 'completed' && typeof output === 'string') {
      let analyses;
      try { analyses = JSON.parse(output)?.analyses; }
      catch { return { ...reply, issue:'format' }; }
      if (Array.isArray(analyses) && analyses.length === group.length) return { ...reply, analyses };
    }
    return { ...reply, issue:'format' };
  } catch {
    return { status:'request_failed' };
  }
}

async function writeGroup(group, options) {
  const applyDrafts = (items, { status, issue, analyses, modelUsed }) => {
    const incomplete = [];
    items.forEach((item, i) => {
      const { report, evidence, draft } = item;
      const { feedback } = report;
      // Preserve proof that GPT responded if a retry fails before a response arrives.
      if (status !== 'response_rejected' && feedback.aiApiStatus === 'response_rejected') return;
      feedback.aiApiStatus = status;
      if (status !== 'response_rejected') return;
      if (modelUsed) feedback.aiModel = modelUsed;
      const result = acceptedAnalysis(analyses?.[i], evidence);
      if (result) {
        item.draft = {
          sentences: { ...result.sentences, ...draft?.sentences },
          highlights: draft?.highlights.length ? draft.highlights : result.highlights,
        };
        if (FIELDS.every(field => !evidence[field] || item.draft.sentences[field]) &&
            (item.draft.highlights.length || !HIGHLIGHTS.some(field => evidence[field]))) {
          useAnalysis(report, evidence, item.draft);
          return;
        }
      }
      feedback.aiResponseIssue = issue || (result ? 'wording' : 'format');
      if (issue !== 'refusal') incomplete.push(item);
    });
    return incomplete;
  };

  const first = await requestDrafts(group, options, false);
  const incomplete = applyDrafts(group, first);
  if (incomplete.length) applyDrafts(incomplete, await requestDrafts(incomplete, options, true));
  return ['authentication_failed', 'model_unavailable'].includes(first.status) ? first.status : 'report_failed';
}

export async function writeTeacherReports(data, { fetchImpl, readKey, model }) {
  const reports = data.reports.filter(report => report.feedback);
  const pending = reports.filter(report => report.feedback.engine?.summaryReflection)
    .map(report => ({ report, evidence:buildEvidence(report.feedback) })).filter(item => item.evidence.plan);
  const key = readKey()?.trim();
  for (const report of reports) report.feedback.aiApiStatus = key ? 'no_facts' : 'missing_key';
  let state = key ? 'report_no_facts' : 'missing_key';
  if (key && pending.length) {
    const groups = [];
    for (let i = 0; i < pending.length; i += 4) groups.push(pending.slice(i,i+4));
    const states = await Promise.all(groups.map(group => writeGroup(group, { fetchImpl, key, model })));
    state = reports.some(report => report.feedback.aiApiStatus === 'applied') ? 'report_written' : states[0];
  }
  for (const report of reports) if (report.feedback.aiApiStatus !== 'applied') useRule(report);
  return { ...data, aiVerification:{ state } };
}
