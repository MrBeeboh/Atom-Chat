/**
 * Plain rows for one judged arena round. Safe in the browser.
 * Scores are copied from the judge. Missing numbers stay null.
 */
function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function emptyTags() {
  return { tag_thinking: null, tag_tools: null, tag_vision: null, context_bucket: null };
}

/**
 * One finished judged question. Does not invent a score.
 * Arena text/vision/code is the test type. Code is not a model list.
 * @param {{ entry: object, layout?: string, arena?: string, startedAt?: string, nameForId?: (id: string) => string, catalog?: object|null, capsById?: Record<string, object|null> }} opts
 */
export function rowsForJudgedRound({
  entry,
  layout = 'compact',
  arena = '',
  startedAt,
  nameForId = (id) => id,
  tagsForId = () => emptyTags(),
}) {
  const answers = Array.isArray(entry?.answers) ? entry.answers : [];
  const ids = answers.map((a) => String(a?.modelId || '').trim()).filter(Boolean);
  const question = entry?.questionText != null && String(entry.questionText).trim()
    ? String(entry.questionText)
    : null;
  const battle = arena === 'vision' || arena === 'code' || arena === 'text' ? arena : '';
  const category = typeof entry?.category === 'string' && entry.category.trim() ? entry.category.trim() : '';
  const testType = battle === 'code' ? 'code' : (category || battle || null);
  const rows = answers.map((a) => {
    const modelId = String(a?.modelId || '').trim();
    const rawScore = entry?.scores ? entry.scores[a.slot] : null;
    const score = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null;
    const opponents = ids.filter((id) => id !== modelId);
    const tags = modelId ? { ...emptyTags(), ...(tagsForId(modelId) || {}) } : emptyTags();
    return {
      model_id: modelId || null,
      model_name: modelId ? (nameForId(modelId) || modelId) : null,
      opponent_ids: opponents.length ? opponents.join(', ') : null,
      question,
      score,
      tokens_in: finiteOrNull(a?.promptTokens),
      tokens_out: finiteOrNull(a?.completionTokens),
      tokens_cache: finiteOrNull(a?.cachedTokens),
      cost: finiteOrNull(a?.cost),
      had_svg: /<svg\b/i.test(String(a?.text || '')) ? 1 : 0,
      test_type: testType,
      ...tags,
    };
  });
  return {
    started_at: startedAt || new Date().toISOString(),
    question_count: 1,
    layout: layout === 'long' ? 'long' : 'compact',
    arena: battle || null,
    question,
    test_type: testType,
    entries: rows,
  };
}

