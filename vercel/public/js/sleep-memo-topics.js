export const sleepMemoCategories = Object.freeze({
  timing: '취침·기상',
  interruption: '수면 방해',
  condition: '피로·컨디션',
  habits: '생활 습관',
  caffeine: '카페인·음료',
});

const topics = [
  ['sleepOnset', '잠들기 어려움', 'interruption', /잠(?:이|을)?\s*(?:잘\s*)?(?:안\s*(?:오|왔)|오지\s*않|못\s*들)|잠들기까지.{0,8}(?:오래|걸렸)|뒤척|불면/],
  ['nightWaking', '밤중에 깸', 'interruption', /(?:자다가|밤중|한밤중|새벽에).{0,10}(?:깼|깨었|일어났)|잠이\s*깼/],
  ['lateBedtime', '늦은 취침', 'timing', /늦게\s*(?:잤|잠들|자서|자기)|늦은\s*취침|새벽.{0,6}(?:잠들|잤)/],
  ['earlyBedtime', '이른 취침', 'timing', /일찍\s*(?:잤|잠들|자서|자기)|이른\s*취침/],
  ['earlyWake', '이른 기상', 'timing', /일찍\s*(?:깼|일어났|일어나)|이른\s*기상/],
  ['fatigue', '피로·무기력', 'condition', /피곤(?!하지\s*않)|피로|무기력|맥아리\s*없|기운이\s*없|지쳤/],
  ['sleepiness', '졸림', 'condition', /졸렸|졸리(?!지\s*않)|졸음|꾸벅/],
  ['refreshed', '개운함·숙면', 'condition', /개운(?:했|하다|해서|해요)|상쾌(?:했|하다|해서)|푹\s*(?:잤|잠들)|잘\s*잤/],
  ['headache', '두통', 'condition', /두통|머리(?:가|도)?\s*아(?:프|팠)/],
  ['worry', '걱정·불안', 'interruption', /걱정(?:이|돼|되|했)|불안(?!하지\s*않)|생각이\s*많/],
  ['screens', '스마트폰·화면 사용', 'habits', /핸드폰|휴대폰|스마트폰|유튜브|휴대전화|(?:^|\s)폰(?:을|은|도)?(?=\s|$)|화면을\s*보/],
  ['exercise', '운동·산책', 'habits', /운동(?:을|했|하|으로)|산책|걷기/],
  ['studying', '공부·시험', 'habits', /공부|시험|과제|숙제/],
  ['caffeineIntake', '카페인·음료 언급', 'caffeine', /카페인|커피|아메리카노|에너지\s*음료|녹차|홍차|콜라/],
  ['noCaffeine', '카페인 미섭취', 'caffeine', /(?:카페인|커피|에너지\s*음료|녹차|홍차|콜라)(?:을|를|은|는|도)?\s*(?:(?:전혀|아예)\s*)?(?:안\s*마셨|안\s*마시|마시지\s*않|마신\s*적이\s*없|섭취하지\s*않|안\s*먹)/],
];

export const sleepMemoTopics = Object.freeze(Object.fromEntries(topics.map(([id, label, category]) =>
  [id, Object.freeze({ label, category })])));

export const MAX_SLEEP_MEMO_PAIRS = 10;
export const sleepMemoPairId = (left, right) => left + '|' + right;

const noScreens = /(?:핸드폰|휴대폰|스마트폰|유튜브|휴대전화|화면|(?:^|\s)폰)(?:을|를|은|는|도)?\s*(?:(?:전혀|아예|거의)\s*)?(?:안\s*(?:봤|보|했|썼|쓰|켰|사용)|(?:보|쓰|켜|사용하|하)지\s*않)/;
const noCaffeine = topics.find(([id]) => id === 'noCaffeine')[3];

export function summarizeSleepMemos(memos) {
  const counts = new Map();
  const pairs = new Map();
  for (const memo of memos) {
    if (typeof memo !== 'string' || !memo.trim()) continue;
    const memoTopics = new Set();
    const memoPairs = new Set();
    for (const sentence of memo.normalize('NFC').split(/[\n.!?。！？]+/)) {
      const sentenceTopics = new Set();
      // Keep clauses separate for negation but count co-occurrence within the sentence.
      for (const clause of sentence.split(/[,，;]|(?:고|지만|는데)\s+/)) {
        for (const [id, , , pattern] of topics) {
          if (id === 'screens' && noScreens.test(clause)) continue;
          if (id === 'caffeineIntake' && noCaffeine.test(clause)) continue;
          if (pattern.test(clause)) sentenceTopics.add(id);
        }
      }
      const sorted = [...sentenceTopics].sort();
      for (const [index, left] of sorted.entries()) {
        memoTopics.add(left);
        for (const right of sorted.slice(index + 1)) memoPairs.add(sleepMemoPairId(left, right));
      }
    }
    for (const id of memoTopics) counts.set(id, (counts.get(id) || 0) + 1);
    for (const id of memoPairs) pairs.set(id, (pairs.get(id) || 0) + 1);
  }
  const byCount = (a, b) => b[1] - a[1];
  return {
    topics: [...counts].sort(byCount),
    pairs: [...pairs].sort(byCount).slice(0, MAX_SLEEP_MEMO_PAIRS)
      .map(([id, count]) => [...id.split('|'), count]),
  };
}
