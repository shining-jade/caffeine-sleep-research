const MODEL = 'gpt-4.1-mini';
const EXPLANATION_TITLE = '💡 알아 두면 좋아요';
const TOPICS = ['sleep_duration', 'caffeine_amount', 'bedtime', 'screen', 'activity', 'tracking'];
const UNSAFE_COACHING = /[\p{Extended_Pictographic}\r\n<>]|(?:질환|진단|장애|치료|처방|때문에\s*당신|네가|학생은|반드시|무조건|확실히|다음\s*주|보충했|약속)/u;
const numbersIn = value => value.match(/\d+(?:\.\d+)?/g)?.join(',') || '';
const TOPIC_PATTERNS = [
  ['sleep_duration', /잠자리에 들 준비를 15분|취침·기상 간격이 짧/],
  ['caffeine_amount', /카페인 함량을 비교|카페인이 없는 음료|포장이나 메뉴/],
  ['bedtime', /취침 준비 시각|기상 시각이나 중간에/],
  ['screen', /스마트폰/],
  ['activity', /걷기|신체활동/],
];

export function createTeacherOpenAI({ fetchImpl = fetch, readKey = () => process.env.OPENAI_API_KEY } = {}) {
  let cache;
  let pending;

  async function verify() {
    const key = readKey()?.trim();
    if (!key) return { state: 'missing_key' };
    const headers = { Authorization: 'Bearer ' + key };
    const request = (pathname, options = {}) => fetchImpl('https://api.openai.com/v1/' + pathname, {
      ...options, headers: { ...headers, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(6500),
    });
    let organization;
    try {
      const response = await request('responses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, store: false, max_output_tokens: 180,
          instructions: 'You prioritize evidence-based educational sleep and caffeine coaching topics for a teacher. This request contains synthetic records only. Rank every listed topic once. Give direct behavior changes priority over record keeping. For the validation case, prioritize the observed concern over missing records.',
          input: JSON.stringify({ topics: TOPICS, syntheticCase: {
            sleepIntervalsHours: [6, 6.5, 7], caffeineRecorded: false,
            options: ['tracking', 'sleep_duration'],
          } }),
          text: { format: {
            type: 'json_schema', name: 'teacher_coaching_priority', strict: true,
            schema: {
              type: 'object', additionalProperties: false, required: ['syntheticPriority', 'priorities'],
              properties: {
                syntheticPriority: { type: 'string', enum: ['tracking', 'sleep_duration'] },
                priorities: { type: 'array', items: { type: 'string', enum: TOPICS } },
              },
            },
          } },
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        const code = failure?.error?.code;
        const reason = ['invalid_api_key', 'insufficient_quota', 'model_not_found', 'rate_limit_exceeded'].includes(code)
          ? code : undefined;
        return { state: [401, 403].includes(response.status) ? 'authentication_failed' : 'synthetic_failed',
          status: response.status, reason };
      }
      const header = response.headers.get('openai-organization');
      if (!/^[a-z][a-z0-9_.-]{0,99}$/i.test(header || '') || /^sk-/i.test(header)) {
        return { state: 'organization_unavailable' };
      }
      organization = header;
      const body = await response.json();
      const output = body.output?.flatMap(item => item.type === 'message' ? item.content : [])
        .find(item => item.type === 'output_text')?.text;
      const parsed = JSON.parse(output);
      const priorities = parsed.priorities;
      if (body.status !== 'completed' || parsed.syntheticPriority !== 'sleep_duration' ||
          !Array.isArray(priorities) || priorities.length !== TOPICS.length ||
          !TOPICS.every(topic => priorities.includes(topic))) {
        return { state: 'synthetic_failed', organization };
      }
      return { state: 'verified', organization, priorities };
    } catch {
      return { state: organization ? 'synthetic_failed' : 'connection_failed', organization };
    }
  }

  function getVerification() {
    if (cache?.expires > Date.now()) return Promise.resolve(cache.result);
    pending ||= verify().then(result => {
      const ttl = result.state === 'verified' ? 15 * 60_000 : 30_000;
      cache = { result, expires: Date.now() + ttl };
      return result;
    }).finally(() => { pending = undefined; });
    return pending;
  }

  async function refineExplanations(explanations) {
    const key = readKey()?.trim();
    if (!key || !explanations.size) return null;
    const expected = [...explanations.keys()];
    try {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6500),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, store: false, max_output_tokens: 1600,
          instructions: 'Under 알아 두면 좋아요, lightly rephrase only these approved Korean general health explanations for teens. Keep every qualifier, number and mechanism. Never add a claim, infer an individual cause, diagnose, promise follow-up or include emojis. Keep each ID once. Keep both directions for screen use.',
          input: JSON.stringify([...explanations].map(([id, text]) => ({ id, text }))),
          text: { format: { type: 'json_schema', name: 'teacher_good_to_know', strict: true, schema: {
            type: 'object', additionalProperties: false, required: ['sectionTitle', 'items'], properties: {
              sectionTitle: { type: 'string', enum: [EXPLANATION_TITLE] },
              items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'],
                properties: { id: { type: 'string', enum: expected }, text: { type: 'string' } } } },
            },
          } } },
        }),
      });
      if (!response.ok) return null;
      const body = await response.json();
      const output = body.output?.flatMap(item => item.type === 'message' ? item.content : [])
        .find(item => item.type === 'output_text')?.text;
      const { sectionTitle, items } = JSON.parse(output);
      if (body.status !== 'completed' || sectionTitle !== EXPLANATION_TITLE || !Array.isArray(items) || items.length !== expected.length) return null;
      const results = new Map();
      for (const { id, text } of items) {
        const original = explanations.get(id);
        if (!original || results.has(id) || typeof text !== 'string' || text.trim().length < 15 || text.length > 260
            || UNSAFE_COACHING.test(text) || numbersIn(text) !== numbersIn(original)
            || (id === 'phoneBeforeBed' && !/잠.{0,12}(오지 않|안 오|잘 안).{0,35}(화면|스마트폰)/.test(text))) return null;
        results.set(id, text.trim());
      }
      return results;
    } catch {
      return null;
    }
  }

  async function refineSummaryReflections(data) {
    const eligible = data.reports.filter(report => report.feedback?.engine?.summaryReflection);
    const summaries = eligible.map(report => report.feedback.engine.summaryReflection);
    // Forward only aggregate counts and allowlisted categories. No identities, dates, labels or report text.
    const allowed = ['caffeineMax', 'bedtime', 'sleepMin', 'wakeTime', 'phone', 'activity', 'range', 'other', 'sleepRecords', 'caffeineRecords'];
    const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 366;
    const goal = fact => fact && allowed.includes(fact.kind) && count(fact.measured) && count(fact.kept) && fact.measured > 0 && fact.kept <= fact.measured
      ? { kind: fact.kind, measured: fact.measured, kept: fact.kept } : null;
    const facts = summaries.map(({ facts }) => {
      const difficulty = goal(facts?.difficulty);
      const observation = facts?.difficulty?.observation;
      return {
        praise: goal(facts?.praise),
        difficulty: difficulty && { ...difficulty, observation: ['phone30', 'afternoonCaffeine'].includes(observation?.kind) &&
          count(observation.count) && observation.count >= 2 && observation.count <= difficulty.measured - difficulty.kept
          ? { kind: observation.kind, count: observation.count } : null },
        plan: ['recordedBedtime', 'recordedCaffeine', 'recordedWake', 'recordedPhone', 'recordedActivity'].includes(facts?.plan?.kind)
          ? { kind: facts.plan.kind } : null,
      };
    });
    const slots = ['praise', 'difficulty', 'plan'];
    const options = ['rule', 'warm'];
    const fallback = state => {
      for (const report of data.reports) {
        if (!report.feedback) continue;
        const summary = report.feedback.engine?.summaryReflection;
        if (summary) report.feedback.summaryReflection = { ...summary.rule };
        report.feedback.mode = 'rule';
        report.feedback.aiFallback = true;
      }
      return { ...data, aiVerification: { state } };
    };
    try {
      const key = readKey()?.trim();
      if (!key) return fallback('missing_key');
      if (!facts.some(entry => slots.some(slot => entry[slot]))) return fallback('reflection_no_facts');
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6500),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, store: false, max_output_tokens: 1800,
          instructions: 'For each set of Korean student reflection facts, choose the phrasing style for praise, difficulty and plan: rule (direct) or warm (conversational). Return exactly one set of choices per input, in the same order. Choose rule for null facts. Do not return prose, facts, numbers, diagnoses or advice. The application will insert only the original facts in approved wording.',
          input: JSON.stringify(facts),
          text: { format: { type: 'json_schema', name: 'teacher_reflection_wording', strict: true, schema: {
            type: 'object', additionalProperties: false, required: ['choices'], properties: {
              choices: { type: 'array', items: { type: 'object', additionalProperties: false, required: slots,
                properties: Object.fromEntries(slots.map(slot => [slot, { type: 'string', enum: options }])) } },
            },
          } } },
        }),
      });
      if (!response.ok) return fallback([401, 403].includes(response.status) ? 'authentication_failed' : 'reflection_failed');
      const body = await response.json();
      const output = body.output?.flatMap(item => item.type === 'message' ? item.content : [])
        .find(item => item.type === 'output_text')?.text;
      const parsed = JSON.parse(output);
      const choices = parsed?.choices;
      if (body.status !== 'completed' || Object.keys(parsed).length !== 1 || !Array.isArray(choices) ||
          choices.length !== summaries.length || choices.some(choice => !choice || Object.keys(choice).length !== slots.length ||
            !slots.every(slot => options.includes(choice[slot])))) return fallback('reflection_failed');
      for (const report of data.reports) {
        if (!report.feedback) continue;
        const index = eligible.indexOf(report);
        const summary = summaries[index];
        if (!summary || !slots.some(slot => facts[index][slot])) {
          if (summary) report.feedback.summaryReflection = { ...summary.rule };
          report.feedback.mode = 'rule';
          report.feedback.aiFallback = true;
          continue;
        }
        report.feedback.summaryReflection = Object.fromEntries(slots.map(slot =>
          [slot, choices[index][slot] === 'warm' && facts[index][slot] ? summary.warm[slot] : summary.rule[slot]]));
        report.feedback.mode = 'ai';
        report.feedback.aiFallback = false;
      }
      return { ...data, aiVerification: { state: 'reflection_refined' } };
    } catch {
      return fallback('reflection_failed');
    }
  }

  return async function applyTeacherAI(data) {
    if (!data?.success || !Array.isArray(data.reports) || !data.reports.some(report => report.feedback)) return data;
    if (data.reports.some(report => report.feedback?.engine?.summaryReflection)) return refineSummaryReflections(data);
    const { priorities, ...verification } = await getVerification();
    const explanations = new Map();
    for (const { feedback } of data.reports) {
      const engine = feedback?.engine;
      if (!engine) continue;
      const selected = new Set(engine.explanationFindingIds ?? engine.featuredFindingIds);
      for (const finding of engine.findings) {
        if (selected.has(finding.id) && finding.result !== 'similar' && finding.refs.length && finding.why) explanations.set(finding.id, finding.why);
      }
    }
    const rewritten = priorities && await refineExplanations(explanations);
    for (const report of data.reports) {
      const feedback = report.feedback;
      if (!feedback) continue;
      feedback.mode = 'rule';
      feedback.aiFallback = !priorities;
      if (!priorities) continue;
      if (feedback.engine) {
        const section = feedback.sections.find(section => section.id === 'why');
        feedback.aiFallback = !section || !rewritten;
        if (feedback.aiFallback) continue;
        const seen = new Map();
        for (const id of feedback.engine.explanationFindingIds ?? feedback.engine.featuredFindingIds) {
          const original = explanations.get(id);
          if (original && !seen.has(original)) seen.set(original, rewritten.get(id));
        }
        section.items = [...seen.values()];
        feedback.mode = 'ai';
        report.analysis = feedback.sections.map(item => [(item.icon ? item.icon + ' ' : '') + item.title, ...item.items].join('\n')).join('\n\n');
        continue;
      }
      const next = feedback.sections?.find(section => section.tone === 'next');
      if (!next?.items?.length) continue;
      const rank = item => {
        const topic = TOPIC_PATTERNS.find(([, pattern]) => pattern.test(item))?.[0] || 'tracking';
        return priorities.indexOf(topic);
      };
      next.items = [...next.items].sort((a, b) => rank(a) - rank(b));
      feedback.mode = 'ai';
    }
    return { ...data, aiVerification: verification };
  };
}

export const applyTeacherAI = createTeacherOpenAI();
