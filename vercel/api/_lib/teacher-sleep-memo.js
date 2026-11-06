import { MAX_SLEEP_MEMO_PAIRS, sleepMemoCategories, sleepMemoPairId, sleepMemoTopics } from '../../public/js/sleep-memo-topics.js';

export function validateSleepMemoSummary(summary) {
  if (!summary || typeof summary !== 'object' || Object.keys(summary).length !== 2) return false;
  const { topics, pairs } = summary;
  if (!Array.isArray(topics) || topics.length === 0 || topics.length > Object.keys(sleepMemoTopics).length ||
      !Array.isArray(pairs) || pairs.length > MAX_SLEEP_MEMO_PAIRS) return false;
  const counts = new Map();
  for (const entry of topics) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [id, count] = entry;
    if (typeof id !== 'string' || !Object.hasOwn(sleepMemoTopics, id) || counts.has(id) ||
        !Number.isSafeInteger(count) || count < 1 || count > 100000) return false;
    counts.set(id, count);
  }
  const pairIds = new Set();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 3) return false;
    const [left, right, count] = pair;
    if (!counts.has(left) || !counts.has(right) || left >= right ||
        !Number.isSafeInteger(count) || count < 1 || count > Math.min(counts.get(left), counts.get(right))) return false;
    const id = sleepMemoPairId(left, right);
    if (pairIds.has(id)) return false;
    pairIds.add(id);
  }
  return true;
}

export async function analyzeSleepMemoTopics(summary, { fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY } = {}) {
  if (!validateSleepMemoSummary(summary)) return { status: 'invalid' };
  if (!apiKey?.trim()) return { status: 'unavailable' };
  const ids = summary.topics.map(([id]) => id);
  const pairIds = summary.pairs.map(([left, right]) => sleepMemoPairId(left, right));
  const categories = Object.keys(sleepMemoCategories);
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + apiKey.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6-luna', reasoning: { effort: 'none' }, store: false, max_output_tokens: 650,
        instructions: 'Classify each supplied sleep memo topic ID into one category. Assign each ID exactly once. Select up to three distinct topic IDs worth reviewing. If sentencePairs is nonempty, select one supplied pair ID worth reviewing as pairHighlight, prioritizing frequent pairs; otherwise return null. Each pair counts records where both topics occur within a sentence. Counts are records, not students. Do not infer causes, diagnoses, or trends. Return only IDs from the supplied data.',
        input: JSON.stringify({
          categories: sleepMemoCategories,
          topics: summary.topics.map(([id, count]) => ({ id, label: sleepMemoTopics[id].label, count })),
          sentencePairs: summary.pairs.map(([left, right, count]) => ({ id: sleepMemoPairId(left, right), count })),
        }),
        text: { format: { type: 'json_schema', name: 'sleep_memo_topics', strict: true, schema: {
          type: 'object', additionalProperties: false, required: ['assignments', 'highlights', 'pairHighlight'],
          properties: {
            assignments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['topic', 'category'],
              properties: { topic: { type: 'string', enum: ids }, category: { type: 'string', enum: categories } } } },
            highlights: { type: 'array', items: { type: 'string', enum: ids } },
            pairHighlight: pairIds.length ? { type: 'string', enum: pairIds } : { type: 'null' },
          },
        } } },
      }),
    });
    if (!response.ok) return { status: 'unavailable' };
    const body = await response.json();
    const output = body.output?.flatMap(item => item.type === 'message' ? item.content || [] : [])
      .find(item => item.type === 'output_text')?.text;
    if (body.status !== 'completed' || typeof output !== 'string') return { status: 'unavailable' };
    const { assignments, highlights, pairHighlight } = JSON.parse(output);
    if (!Array.isArray(assignments) || assignments.length !== ids.length ||
        !assignments.every(item => item && ids.includes(item.topic) && categories.includes(item.category)) ||
        new Set(assignments.map(item => item.topic)).size !== ids.length ||
        !Array.isArray(highlights) || highlights.length < 1 || highlights.length > 3 ||
        new Set(highlights).size !== highlights.length || !highlights.every(id => ids.includes(id)) ||
        (pairIds.length ? !pairIds.includes(pairHighlight) : pairHighlight !== null)) return { status: 'unavailable' };
    return { status: 'ai', assignments, highlights, pairHighlight };
  } catch {
    return { status: 'unavailable' };
  }
}
