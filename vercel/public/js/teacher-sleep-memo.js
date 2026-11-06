import { sleepMemoCategories, sleepMemoPairId, sleepMemoTopics, summarizeSleepMemos } from './sleep-memo-topics.js?v=2';

const colorPalette = ['#6366f1', '#a3388c', '#986116', '#137b65', '#2858b3'];
const topicSupport = {
  sleepOnset: ['잠들기 어려움을 적은 메모가', '잠들기 힘들었던 날의 메모를 학생과 함께 살피고, 부담 없이 해 볼 수 있는 취침 준비를 하나 정합니다.'],
  nightWaking: ['밤중에 깼다고 적은 메모가', '밤중에 깬 뒤 학교생활에 불편이 있었는지 살피고, 필요한 도움을 학생과 함께 정합니다.'],
  lateBedtime: ['늦게 잠자리에 들었다고 적은 메모가', '늦어지는 날의 일정에서 학생이 조정할 수 있는 일이 있는지 함께 살펴봅니다.'],
  earlyBedtime: ['일찍 잠자리에 들었다고 적은 메모가', '일찍 잠자리에 들기 수월했던 날의 일과를 살피고, 학생이 이어 가고 싶은 방법을 정하도록 돕습니다.'],
  earlyWake: ['일찍 일어났다고 적은 메모가', '기상 뒤 피로가 함께 적혔는지 살피고, 학생이 아침 일정을 준비하는 데 필요한 도움을 확인합니다.'],
  fatigue: ['피곤하거나 기운이 없었다고 적은 메모가', '피곤함이 학교생활에 불편을 주는지 살피고, 수업이나 활동 중 조정이 필요한 부분을 학생과 함께 확인합니다.'],
  sleepiness: ['졸림을 적은 메모가', '졸림을 겪은 시간대에 수업이나 활동이 힘들었는지 살피고, 필요한 지원을 학생과 함께 정합니다.'],
  refreshed: ['푹 잤거나 개운했다고 적은 메모가', '컨디션이 좋았던 날 학생이 편하게 이어 갈 수 있는 생활 습관을 함께 찾아봅니다.'],
  headache: ['머리가 아팠다고 적은 메모가', '머리가 아픈 날 수업이나 활동에 불편이 있었는지 살피고, 필요하면 학교에서 받을 수 있는 도움을 안내합니다.'],
  worry: ['걱정이나 불안을 적은 메모가', '학생이 원하면 조용히 이야기할 시간을 마련하고, 어떤 도움을 받고 싶은지 살핍니다.'],
  screens: ['스마트폰이나 화면을 언급한 메모가', '화면을 쓰는 시간이나 상황을 원문에서 살피고, 학생이 원하면 취침 전 일과를 정하도록 돕습니다.'],
  exercise: ['운동이나 산책을 언급한 메모가', '학생이 부담 없이 이어 갈 수 있는 활동과 일정을 함께 살펴봅니다.'],
  studying: ['공부나 시험을 언급한 메모가', '과제나 시험 준비 일정에 부담이 있었는지 살피고, 일정을 나눠 계획하도록 돕습니다.'],
  caffeineIntake: ['카페인이나 음료를 언급한 메모가', '음료의 종류와 시각이 적혀 있다면 섭취 기록과 함께 살펴보고, 학생이 음료를 선택할 때 참고하도록 돕습니다.'],
  noCaffeine: ['카페인을 마시지 않았다고 적은 메모가', '카페인을 마시지 않은 날의 상태도 원문에서 살피고, 학생이 계속하고 싶은 습관을 함께 정합니다.'],
};
const pairSupport = {
  'screens|sleepOnset': '원문에서 화면을 사용한 상황을 살피고, 학생과 해 볼 만한 취침 준비를 하나 정합니다. 다음 메모에서 잠들기까지 어땠는지 함께 살펴봅니다.',
  'caffeineIntake|sleepOnset': '잠들기 어려웠던 날의 메모와 음료 기록을 함께 살피고, 학생이 다음에 음료를 고를 때 참고하도록 돕습니다.',
  'noCaffeine|sleepOnset': '음료 외에 메모에 적힌 그날의 일과와 취침 준비를 살피고, 학생에게 필요한 도움을 함께 정합니다.',
  'lateBedtime|sleepiness': '늦게 잔 날의 일과와 졸렸던 시간대를 살피고, 학생과 조정 가능한 일정이 있는지 확인합니다.',
};
const stateTopics = ['sleepOnset', 'nightWaking', 'fatigue', 'sleepiness', 'headache', 'worry', 'refreshed'];
let summary = { topics: [], pairs: [] };
let sources;
let sourcesByTopic;
let generation = 0;
let pending = false;

const get = id => document.getElementById(id);
function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function fillMemoSourceList(list, memos) {
  list.replaceChildren(...memos.map(({ text, student, date }) => {
    const row = element('li', '');
    const label = [student, date && date + ' 밤'].filter(Boolean).join(' · ');
    if (label) row.append(element('strong', label));
    row.append(element('p', text));
    return row;
  }));
}

export function renderSleepMemoAnalysis(memos) {
  const nextSources = memos.filter(({ text }) => typeof text === 'string' && text.trim());
  if (sources?.length === nextSources.length && sources.every(({ text, student, date }, index) =>
    text === nextSources[index].text && student === nextSources[index].student && date === nextSources[index].date)) return;
  sources = nextSources;
  sourcesByTopic = new Map();
  summary = summarizeSleepMemos(sources.map(({ text }) => text), (index, topics) => {
    for (const id of topics) {
      if (!sourcesByTopic.has(id)) sourcesByTopic.set(id, []);
      sourcesByTopic.get(id).push(sources[index]);
    }
  });
  generation++;
  pending = false;
  const details = get('sleepMemoSources');
  details.open = false;
  details.hidden = !sources.length;
  get('sleepMemoSourceLabel').textContent = '학생 메모 원문 보기 (' + sources.length + '건)';
  fillMemoSourceList(get('sleepMemoSourceList'), sources);
  const button = get('sleepMemoAiBtn');
  const hasTopics = summary.topics.length > 0;
  const empty = get('sleepMemoNoData');
  empty.hidden = hasTopics;
  empty.textContent = sources.length
    ? '메모 ' + sources.length + '건이 있습니다. 아래 원문을 펼쳐 학생이 남긴 내용을 확인할 수 있습니다.'
    : '선택한 기간에 남긴 수면 메모가 없습니다.';
  get('sleepMemoAiArea').hidden = !hasTopics;
  button.disabled = false;
  button.textContent = 'Luna로 핵심 찾기';
  button.onclick = analyze;
  if (hasTopics) renderResult(summary);
  else get('sleepMemoAiResult').replaceChildren();
}

async function analyze() {
  if (pending || !summary.topics.length) return;
  const requestGeneration = generation;
  const snapshot = summary;
  const button = get('sleepMemoAiBtn');
  pending = true;
  button.disabled = true;
  button.textContent = 'Luna로 분석 중…';
  let analysis;
  try {
    analysis = await new Promise((resolve, reject) => {
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).analyzeSleepMemoTopics(snapshot);
    });
  } catch {
    analysis = null;
  }
  if (requestGeneration !== generation) return;
  pending = false;
  button.disabled = false;
  button.textContent = 'Luna로 핵심 찾기';
  renderResult(snapshot, analysis, true);
  const result = get('sleepMemoAiResult');
  if (result.getClientRects().length) {
    result.focus({ preventScroll: true });
    const headerBottom = document.querySelector('header').getBoundingClientRect().bottom;
    window.scrollBy(0, result.getBoundingClientRect().top - headerBottom - 12);
  }
}

function renderTopic(id, count) {
  const memos = sourcesByTopic.get(id);
  const disclosure = element('details', '');
  disclosure.className = 'sleep-memo-topic';
  disclosure.dataset.topic = id;
  disclosure.append(element('summary', sleepMemoTopics[id].label + ' (' + count + '건)'));
  disclosure.ontoggle = () => {
    if (!disclosure.open || disclosure.childElementCount > 1) return;
    const originals = element('ol', '');
    originals.className = 'sleep-memo-source-list';
    fillMemoSourceList(originals, memos);
    disclosure.append(originals);
  };
  const row = element('li', '');
  row.append(disclosure);
  return row;
}

function renderResult(snapshot, analysis, requested = false) {
  const result = get('sleepMemoAiResult');
  const usedLuna = analysis?.status === 'ai';
  const assignments = usedLuna ? new Map(analysis.assignments.map(({ topic, category }) => [topic, category])) : null;
  const countByTopic = new Map(snapshot.topics);
  const topic = usedLuna ? analysis.highlights[0] :
    snapshot.topics.find(([id]) => stateTopics.includes(id))?.[0] ?? snapshot.topics[0][0];
  const cards = element('div', '');
  cards.className = 'sleep-memo-categories';
  Object.entries(sleepMemoCategories).forEach(([category, label], index) => {
    const ids = snapshot.topics.map(([id]) => id).filter(id => (assignments?.get(id) ?? sleepMemoTopics[id].category) === category);
    if (!ids.length) return;
    const card = element('div', '');
    card.className = 'sleep-memo-category';
    card.style.setProperty('--topic-color', colorPalette[index]);
    card.append(element('strong', label));
    const list = element('ul', '');
    list.append(...ids.map(id => renderTopic(id, countByTopic.get(id))));
    card.append(list);
    cards.append(card);
  });
  const pair = usedLuna
    ? snapshot.pairs.find(([left, right]) => sleepMemoPairId(left, right) === analysis.pairHighlight)
    : snapshot.pairs.find(([left, right]) => left === topic || right === topic);
  const focus = pair ? stateTopics.find(id => pair[0] === id || pair[1] === id) ?? pair[0] : topic;
  let observation = topicSupport[focus][0] + ' ' + countByTopic.get(focus) + '건 있습니다.';
  let support = topicSupport[focus][1];
  if (pair) {
    const [left, right, count] = pair;
    const other = left === focus ? right : left;
    observation += ' 이 중 ' + count + '건에는 ‘' + sleepMemoTopics[other].label + '’도 같은 문장에 적혀 있습니다.';
    support = pairSupport[sleepMemoPairId(left, right)] ?? support;
  }
  const statusText = usedLuna ? 'Luna가 고른 핵심' :
    requested ? 'Luna 응답을 받지 못해 기본 요약을 표시합니다.' : '기본 요약';
  const status = element('p', statusText + ' · 선택 기간의 메모 ' + sources.length + '건 기준');
  status.className = 'sleep-memo-note';
  const insight = element('div', '');
  insight.className = 'sleep-memo-insight';
  insight.append(element('strong', '메모에 나타난 학생 상태'), element('p', observation));
  insight.append(element('strong', '교사가 도울 수 있는 방법'), element('p', support));
  const details = element('details', '');
  details.open = requested;
  details.append(element('summary', '주제별 메모 건수 보기'), cards);
  result.replaceChildren(status, insight, details);
}
