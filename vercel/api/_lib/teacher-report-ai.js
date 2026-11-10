const REPORT_FIELDS = ['caffeineSleep', 'behavior', 'caffeineDays', 'sleepHabits'];
const RECORD_FIELDS = ['recordGood', 'recordReview'];
const REFLECTION_FIELDS = ['praise', 'difficulty', 'plan'];
const COACH_FIELDS = [...RECORD_FIELDS, ...REFLECTION_FIELDS];
const FIELDS = ['record', ...REPORT_FIELDS, ...COACH_FIELDS, 'memo'];
const HIGHLIGHTS = [...REPORT_FIELDS, 'praise', 'difficulty'];
const GOAL_LABELS = {
  caffeineMax: '카페인 섭취량 목표', bedtime: '취침시각 목표', sleepMin: '수면시간 목표',
  wakeTime: '기상시각 목표', phone: '자기 전 스마트폰 목표', activity: '신체활동 목표',
  range: '권장 수면시간 기준', other: '기록으로 확인한 목표',
  sleepRecords: '수면 기록', caffeineRecords: '카페인 기록',
};
const PLAN_TOPICS = {
  bedtime: '잠자리에 들기 전에 알림을 맞추고 하던 일을 마무리하기',
  caffeineMax: '음료를 고르기 전에 카페인 함량을 확인하기',
  wakeTime: '전날 밤에 기상 알람을 미리 맞추기',
  phone: '잠자리에 들기 전에 스마트폰을 손이 닿지 않는 곳에 두기',
  activity: '하교 후 부담 없이 걸을 수 있는 시간을 정해 보기',
  range: '일어날 시각에 맞춰 잠자리 준비를 시작할 때를 미리 정하기',
  sleepMin: '일어날 시각에 맞춰 잠자리 준비를 시작할 때를 미리 정하기',
};
const UNSAFE_TEXT = /[\p{N}\p{Extended_Pictographic}\r\n<>@]|https?:|(?:질환|진단|장애|치료|처방|약물|반드시|무조건|확실히|때문|덕분|탓에|유발|원인으로|학생 이름|학번|연구\s*대상자\s*코드)/iu;
const COACH_FILLER = /모습이 확인|참고할 수 있|살펴볼 수 있|이어\s*가면 좋겠|앞으로도 꾸준히|점을 해냈|점이 구체적/;
const RANGE_DIRECTION = /미달|못\s*미[치친]|미치지 못|(?:짧게|길게)\s*잔|수면시간.{0,12}(?:짧았|길었|부족했|초과했)/;
const FREQUENCY_COMPARISON = /보다(?:는)?\s*(?:더\s*)?(?:많|적)|대부분|절반|더 자주/;

function compare(groups, field, labels, unit) {
  const values = groups.map(group => group.map(day => day[field]).filter(Number.isFinite));
  if (values.some(group => group.length < 2)) return null;
  const [first, second] = values.map(group => (group.reduce((sum, value) => sum + value, 0) / group.length).toFixed(1));
  return `${labels[0]}은 평균 ${first}${unit}(${values[0].length}일), ${labels[1]}은 평균 ${second}${unit}(${values[1].length}일)이다.`;
}

function goalEvidence(goal) {
  if (!goal || !Object.hasOwn(GOAL_LABELS, goal.kind) || !Number.isInteger(goal.measured) ||
      !Number.isInteger(goal.kept) || goal.measured < 1 || goal.measured > 366 || goal.kept < 0 || goal.kept > goal.measured) return null;
  const label = GOAL_LABELS[goal.kind];
  if (goal.kind === 'sleepRecords' || goal.kind === 'caffeineRecords') return `${label}을 ${goal.measured}일 중 ${goal.kept}일 남겼다.`;
  const observation = goal.observation;
  const observed = observation?.kind === 'phone30' ? '자기 전 스마트폰을 30분 이상 사용했다고 기록했다.' :
    observation?.kind === 'afternoonCaffeine' ? '오후 3시 이후 카페인을 섭취했다고 기록했다.' : '';
  const overlap = observed && Number.isInteger(observation.count) && observation.count >= 2 && observation.count <= goal.measured - goal.kept
    ? ` 지키지 못한 날 중 ${observation.count}일은 ${observed}` : '';
  return `확인 가능한 ${goal.measured}일 중 ${goal.kept}일은 ${label}에 맞았다.${overlap}`;
}

// Counts come from the validated goal fact, never the model's prose.
function praiseProgress(goal) {
  const label = GOAL_LABELS[goal.kind];
  const days = goal.measured + '일 ' + (goal.kept === goal.measured ? '모두' : '중 ' + goal.kept + '일');
  if (goal.kind === 'sleepRecords' || goal.kind === 'caffeineRecords') return label + '을 ' + days + ' 남겼다.';
  return '확인한 ' + days + ' ' + label + '에 맞았다.';
}

function buildEvidence({ engine, reportMode }) {
  const finding = id => engine.findings?.find(item => item.id === id)?.data;
  const habit = finding('recordHabit');
  const record = Number.isInteger(habit?.count) && habit.count > 0
    ? `수면이나 카페인 기록을 ${habit.count}일 남겼다.${habit.streak > 1 ? ` 가장 긴 연속 기록은 ${habit.streak}일이다.` : ''}` : null;
  const closed = (finding('bedtimeSeries')?.days || []).filter(day => !day.open);
  const sleep = closed.filter(day => day.recorded && !day.held);
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
    ? `시각을 기록한 카페인 섭취 ${timed.length}번 중 ${late}번은 오후 3시 이후였다.`
    : `카페인 섭취를 ${intakes.length}번 기록했다.`) : zero ? `카페인을 안 마셨다고 기록한 날은 ${zero}일이다.` : null;
  const phoneGroups = finding('phoneBeforeBed')?.members?.map(dates => new Set(dates));
  const sleepHabits = phoneGroups?.length === 2 ? compare(phoneGroups.map(dates => sleep.filter(day => dates.has(day.date))),
    'hours', ['자기 전 스마트폰을 30분 이상 쓴 밤의 수면시간', '그보다 적게 사용했거나 사용하지 않은 밤의 수면시간'], '시간') : null;
  const { praise, difficulty, plan } = engine.summaryReflection.facts || {};
  const missingSleep = closed.filter(day => !day.recorded && !day.held).length;
  const missingCaffeine = closed.filter(day => caffeineByDate.get(day.date) === 'missing').length;
  const limitDays = finding('healthStandards')?.rows?.find(row => row.id === 'caffeineMax')?.days || [];
  const exceeded = limitDays.filter(day => day.kept === false && caffeineByDate.get(day.date) === 'known').length;
  const recordGood = [
    sleep.length ? `완료된 밤 ${closed.length}일 중 유효한 수면 기록을 ${sleep.length}일 남겼다.` : '',
    zero ? `마시지 않은 날을 ‘안 마심’으로 ${zero}일 남겼다.` : '',
  ].filter(Boolean).join(' ') || null;
  const recordReview = [
    exceeded ? `일일 최대 섭취량을 넘긴 날이 ${exceeded}일이다.` : '',
    missingCaffeine ? `카페인 기록이 없는 날은 ${missingCaffeine}일이다.` : '',
    missingSleep ? `수면 기록이 없는 밤은 ${missingSleep}일이다.` : '',
  ].filter(Boolean).join(' ') || null;
  const praiseFact = goalEvidence(praise);
  const evidence = { record, caffeineSleep, behavior, caffeineDays, sleepHabits, recordGood, recordReview,
    praise: praiseFact && zero && praise.kind === 'caffeineMax'
      ? praiseFact + ' 마시지 않은 날도 안 마심으로 남겼다.' : praiseFact,
    difficulty: goalEvidence(difficulty) };
  const success = evidence.praise || recordGood || record;
  const challenge = evidence.difficulty || recordReview;
  const observation = difficulty?.observation;
  const overlapKind = evidence.difficulty && Number.isInteger(observation?.count) &&
    observation.count >= 2 && observation.count <= difficulty.measured - difficulty.kept ? observation.kind : null;
  let nextStep;
  if (overlapKind === 'phone30') {
    nextStep = PLAN_TOPICS.phone;
  } else if (overlapKind === 'afternoonCaffeine') {
    nextStep = '오후에 마실 음료를 미리 정하고 카페인이 없는 선택지도 준비해 보기';
  } else if (evidence.difficulty && Object.hasOwn(PLAN_TOPICS, difficulty.kind)) {
    nextStep = PLAN_TOPICS[difficulty.kind];
  } else if (exceeded) nextStep = PLAN_TOPICS.caffeineMax;
  else if (missingSleep) nextStep = '아침에 일어난 뒤 잠자리에 든 시각부터 남기기';
  else if (missingCaffeine) nextStep = '마신 뒤 바로 기록하고, 마시지 않은 날에는 안 마심을 남기기';
  else if (evidence.praise && Object.hasOwn(PLAN_TOPICS, praise.kind)) nextStep = PLAN_TOPICS[praise.kind];
  else nextStep = '기록하기 편했던 때를 골라 같은 때에 기록을 이어 가기';
  const choices = [nextStep];
  if (overlapKind === 'phone30' && phoneGroups?.[1]?.size) {
    choices.push('스마트폰을 덜 사용한 날의 취침 준비를 떠올려 다음에도 해 보기');
  } else if (nextStep === PLAN_TOPICS.caffeineMax && timed.some(item => item.time >= 900 && item.mg > 0)) {
    choices.push('오후에 음료를 고르기 전에 카페인이 없는 선택지도 확인해 보기');
  } else if (overlapKind === null && plan?.kind === 'recordedBedtime') {
    choices.push('기준을 지켰던 밤의 취침 준비를 떠올려 다시 해 보기');
  }
  const canCoach = Boolean(success || evidence.difficulty || caffeineDays);
  const actionOptions = '제안할 행동 중 하나 선택: ' + choices.join(' / ');
  const planEvidence = canCoach ? [challenge || success || caffeineDays, actionOptions].join(' ') : null;
  const isFinal = (reportMode ?? engine.mode) === 'final';
  const memo = canCoach ? [isFinal ? '연구 종료 후 마무리 분석입니다.' : '', success, challenge,
    actionOptions].filter(Boolean).join(' ') : null;
  return { ...evidence, plan: planEvidence, memo };
}

function acceptedAnalysis(value, evidence) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sentences = {};
  for (const field of FIELDS.filter(field => evidence[field])) {
    if (typeof value[field] !== 'string') continue;
    const sentence = value[field].trim();
    const maxLength = RECORD_FIELDS.includes(field) ? 55 : field === 'difficulty' ? 100 : 72;
    if (sentence.length < 8 || sentence.length > maxLength || UNSAFE_TEXT.test(sentence)) continue;
    if (COACH_FIELDS.includes(field) && field !== 'difficulty') {
      if (!/요[.!?]$/.test(sentence) || /(?:니다|십시오)[.!?](?:\s|$)/.test(sentence) || COACH_FILLER.test(sentence)) continue;
    } else if (field === 'memo') {
      if (!/(?:요|니다)[.!?]$/.test(sentence) || COACH_FILLER.test(sentence) || /감사|고맙|고마|(?:격려|칭찬)(?:합니다|해요)/.test(sentence)) continue;
    } else if (!/다\.$/.test(sentence) || /(?:요|니다|십시오)[.!?](?:\s|$)/.test(sentence)) continue;
    if (field === 'difficulty' && evidence[field].includes(GOAL_LABELS.range) && RANGE_DIRECTION.test(sentence)) continue;
    if ((field === 'praise' || field === 'difficulty') && FREQUENCY_COMPARISON.test(sentence)) continue;
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
  feedback.aiNarrative = Object.fromEntries(REPORT_FIELDS.filter(field => evidence[field])
    .map(field => [field, write(evidence[field], sentences[field])]));
  for (const field of RECORD_FIELDS) if (sentences[field]) feedback.aiNarrative[field] = sentences[field];
  if (sentences.memo) feedback.aiNarrative.memo = sentences.memo;
  const rule = feedback.engine.summaryReflection.rule;
  feedback.summaryReflection = {
    praise: sentences.praise ? write(praiseProgress(feedback.engine.summaryReflection.facts.praise), sentences.praise) : rule.praise,
    difficulty: sentences.difficulty || rule.difficulty,
    plan: sentences.plan,
  };
  const actionTitle = feedback.sections.find(section => section.id === 'action')?.title || '이번 주 해 볼 것';
  const goalItems = ['praise', 'difficulty'].filter(field => {
    const kind = feedback.engine.summaryReflection.facts?.[field]?.kind;
    return sentences[field] && !highlights.includes(field) && kind && kind !== 'sleepRecords' && kind !== 'caffeineRecords';
  }).map(field => feedback.summaryReflection[field]);
  feedback.sections = [
    ...(evidence.record ? [{ id:'record', title:'📝 기록 습관', items:[write(evidence.record, sentences.record)] }] : []),
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

const INSTRUCTIONS = [
  'Write Korean feedback for a school caffeine and sleep log. Return one analysis per input, in order. Use only the evidence supplied for each field. Return null for null inputs.',
  'Blend two roles: a warm, upbeat coach who notices small wins and an objective data expert who states exactly what the log supports. Make success feel attainable without exaggerating, judging or promising a benefit.',
  'The app adds verified figures in the report, including a friendly goal count before praise. Do not generate numbers, dates, clock times, thresholds, scores or amounts. Do not add facts, names, diagnoses, medical advice, links or emojis. Describe co-occurrence without inferring causes. Missing records do not mean a behavior did not happen.',
  'For record, caffeineSleep, behavior, caffeineDays, sleepHabits and difficulty, use plain Korean declarative -다 style, such as 기록을 남겼다 or 함께 나타났다. Do not use -습니다 or -해요 for these factual observations. In comparisons name both groups and follow the observed direction.',
  'For recordGood, recordReview, praise and plan, speak directly to the student in friendly 해요체. End in 요. Use 8 to 72 characters total, or at most 55 for recordGood and recordReview. Use simple verbs, no scolding or commands. Avoid 모습이 확인됩니다, 참고할 수 있어요, 이어가면 좋겠어요, 앞으로도 꾸준히 and vague 살펴봐요.',
  'For recordGood, celebrate a specific entry the student took care to leave. An occasional exclamation mark is fine. For recordReview, offer one gentle alternative tied to a missing entry or verified intake limit. If a caffeine entry is missing, suggest recording whether a drink was consumed without assuming abstinence.',
  'For praise, add a warm, specific reaction to the app’s verified result without repeating it. Notice a small step the student actually took. For example, only when supported: 안 마신 날도 놓치지 않고 적었네요. 잘 챙겼어요! Do not claim a partly met goal was fully met. For difficulty, state only the observed facts in -다 style. Put suggestions in plan. For a missed sleep range say 기준을 벗어난 날. Do not infer that the sleep was short or long or that another behavior caused the result.',
  'For plan, choose just one of the supplied 제안할 행동 options. Choose the most practical option for the observed pattern instead of always choosing the first one. Turn it into one small experiment with a cue about when or where. Vary inviting endings such as 둬 볼까요?, 먼저 확인해 보세요, or 골라 봐요. In a final review choose an action the student can continue after the study.',
  'For memo, write one or two warm sentences, 8 to 72 characters total, as a teacher cheering the student on. Use mostly 해요체. Recognize a specific effort, then encourage the action you chose for plan without copying its wording. Name the action instead of saying 다음 걸음을 골라 봐요. In a final review recognize the effort through the study and encourage continuation without assuming more study records. Avoid generic praise, gratitude, diagnoses and promises.',
  'For highlights choose one or two distinct available fields from caffeineSleep, behavior, caffeineDays, sleepHabits, praise and difficulty, or return an empty list if none are available.',
].join(' ');
const RETRY_INSTRUCTIONS = ' This is a second attempt. Return every supported field. Use plain -다 style for record, caffeineSleep, behavior, caffeineDays, sleepHabits and difficulty. Use 해요체 for recordGood, recordReview, praise and plan, and warm polite Korean for memo. Keep recordGood and recordReview within 55 characters. Use no digits or generic filler. Use only the supplied evidence.';

async function requestDrafts(group, { fetchImpl, key, model }, retry) {
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(retry ? 6500 : 8000),
      headers:{ Authorization:'Bearer '+key, 'Content-Type':'application/json' },
      body:JSON.stringify({
        model, store:false, max_output_tokens:3000,
        ...(model.startsWith('gpt-6') ? { reasoning:{ effort:'none' } } : {}),
        instructions:INSTRUCTIONS + (retry ? RETRY_INSTRUCTIONS : ''),
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
        // Aggregate explanations can stand on their own when the model's
        // extra wording is rejected. Keep the validated coaching sentences.
        if ([...COACH_FIELDS, 'memo'].every(field => !evidence[field] || item.draft.sentences[field]) &&
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
