/**
 * Arena session report data. Scores and scoring comments come from the judge.
 * Costs and token counts are copied from message stats and the pricing catalog.
 * Missing prices stay "cost unknown". Nothing is estimated.
 * Answers are kept in full. The HTML page is built in arenaReportHtml.js.
 */
import { contentToText, computeTotals, contestCategoryTotals } from '$lib/arenaLogic.js';
import { renderReportHtml } from '$lib/arenaReportHtml.js';
import {
  lookupPricing,
  runningCostUsd,
  formatRunningUsd,
  readCachedTokenCount,
  isLocalAtomModel,
} from '$lib/modelPricing.js';

const SLOTS = ['A', 'B', 'C', 'D'];

export function formatReportTime(date, timeZone = 'America/Los_Angeles') {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${fmt.format(date)} PT`;
}

function tokenOrNull(stats, key) {
  if (!stats || stats[key] == null || stats[key] === '') return null;
  const n = Number(stats[key]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} modelId
 * @param {{ prompt: number|null, completion: number|null, cached?: number|null }} usage
 * @param {object|null} catalog
 */
export function costForRecordedUsage(modelId, usage, catalog) {
  if (isLocalAtomModel(modelId)) {
    return { cost: 0, label: '$0.00' };
  }
  if (usage.prompt == null || usage.completion == null) {
    return { cost: null, label: 'cost unknown' };
  }
  const price = lookupPricing(modelId, catalog);
  const cost = runningCostUsd(usage.prompt, usage.completion, price, usage.cached ?? 0);
  if (cost == null) return { cost: null, label: 'cost unknown' };
  return { cost, label: formatRunningUsd(cost) || 'cost unknown' };
}

/**
 * One judged question, taken from the messages the judge just scored.
 */
export function roundEntryFromMessages({
  questionIndex,
  questionText,
  slotsWithResponses,
  scores,
  modelBySlot = {},
  catalog = null,
  category = '',
  comments = {},
}) {
  const answers = [];
  for (const row of slotsWithResponses || []) {
    const slot = row?.slot;
    if (!SLOTS.includes(slot)) continue;
    const msgs = row.msgs || [];
    const assistant = [...msgs].reverse().find((m) => m && m.role === 'assistant');
    const raw = assistant ? contentToText(assistant.content) : '';
    const stats = assistant?.stats;
    const prompt = tokenOrNull(stats, 'prompt_tokens');
    const completion = tokenOrNull(stats, 'completion_tokens');
    const cached = stats ? readCachedTokenCount(stats) : null;
    const modelId = String(modelBySlot[slot] || assistant?.modelId || '');
    const priced = costForRecordedUsage(modelId, { prompt, completion, cached }, catalog);
    answers.push({
      slot,
      modelId,
      text: raw,
      judgeComment: typeof comments?.[slot] === 'string' ? comments[slot].trim() : '',
      promptTokens: prompt,
      completionTokens: completion,
      cachedTokens: cached,
      cost: priced.cost,
      costLabel: priced.label,
    });
  }
  const cat = typeof category === 'string' ? category.trim() : '';
  return {
    questionIndex,
    questionText: String(questionText || ''),
    ...(cat ? { category: cat } : {}),
    scores: { ...(scores || {}) },
    answers,
  };
}

/**
 * Winner from cumulative judge totals. Ties stay ties.
 * Only slots that received a numeric score are eligible.
 * @param {Array<{ scores?: Record<string, number> }>} history
 * @param {Record<string, string>} [modelBySlot]
 */
export function declareArenaWinner(history, modelBySlot = {}) {
  const seen = new Set();
  for (const round of history || []) {
    for (const [slot, score] of Object.entries(round?.scores || {})) {
      if (SLOTS.includes(slot) && typeof score === 'number' && Number.isFinite(score)) seen.add(slot);
    }
  }
  const slots = SLOTS.filter((s) => seen.has(s));
  if (!slots.length) {
    return { tied: false, slots: [], points: null, headline: 'No winner. No scores were recorded.' };
  }
  const totals = computeTotals(history);
  const best = Math.max(...slots.map((s) => totals[s] ?? 0));
  const leaders = slots.filter((s) => (totals[s] ?? 0) === best);
  const name = (s) => (modelBySlot[s] ? `${s} (${modelBySlot[s]})` : s);
  if (slots.length === 1) {
    return {
      tied: false,
      slots,
      points: best,
      headline: `Single contestant: ${name(slots[0])} scored ${best} points. There is no opponent to compare.`,
    };
  }
  if (leaders.length === 1) {
    return {
      tied: false,
      slots: leaders,
      points: best,
      headline: `Winner: ${name(leaders[0])} with ${best} points.`,
    };
  }
  return {
    tied: true,
    slots: leaders,
    points: best,
    headline: `Tied: ${leaders.map(name).join(' and ')} with ${best} points each.`,
  };
}

function sumNullable(values) {
  if (!values.length || values.some((v) => v == null || !Number.isFinite(v))) return null;
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Per-model and session cost. A missing price makes that row "cost unknown".
 */
export function rollupSessionCosts(rounds) {
  /** @type {Map<string, { slot: string, modelId: string, prompts: (number|null)[], completions: (number|null)[], caches: (number|null)[], costs: (number|null)[] }>} */
  const map = new Map();
  for (const round of rounds || []) {
    for (const a of round.answers || []) {
      const key = `${a.slot}\t${a.modelId || ''}`;
      if (!map.has(key)) {
        map.set(key, { slot: a.slot, modelId: a.modelId || '', prompts: [], completions: [], caches: [], costs: [] });
      }
      const row = map.get(key);
      row.prompts.push(a.promptTokens);
      row.completions.push(a.completionTokens);
      row.caches.push(a.cachedTokens);
      row.costs.push(a.cost);
    }
  }
  const models = [...map.values()].map((row) => {
    const allCostsKnown = row.costs.length > 0 && row.costs.every((c) => c != null && Number.isFinite(c));
    const cost = allCostsKnown ? row.costs.reduce((s, n) => s + n, 0) : null;
    return {
      slot: row.slot,
      modelId: row.modelId,
      promptTokens: sumNullable(row.prompts),
      completionTokens: sumNullable(row.completions),
      cachedTokens: sumNullable(row.caches),
      cost,
      costLabel: allCostsKnown ? formatRunningUsd(cost) : 'cost unknown',
    };
  });
  const known = models.filter((m) => m.cost != null);
  const unpriced = models.length - known.length;
  const sessionCost = known.length ? known.reduce((s, m) => s + m.cost, 0) : null;
  let sessionCostLabel = 'cost unknown';
  if (sessionCost != null && unpriced === 0) sessionCostLabel = formatRunningUsd(sessionCost);
  else if (sessionCost != null) sessionCostLabel = `${formatRunningUsd(sessionCost)} plus unpriced`;
  return {
    models,
    sessionCost,
    sessionCostLabel,
  };
}

function findings(rounds, winner, costs) {
  const lines = [];
  lines.push(`${rounds.length} judged question${rounds.length === 1 ? ' is' : 's are'} in this session.`);
  const unknown = costs.models.filter((m) => m.cost == null).map((m) => m.modelId || m.slot);
  if (unknown.length && costs.sessionCost != null) {
    lines.push(`Recorded prices total ${costs.sessionCostLabel}. No price on file for ${unknown.join(', ')}.`);
  } else if (unknown.length) lines.push(`No price on file for ${unknown.join(', ')}. Those rows say cost unknown.`);
  else if (costs.models.length) lines.push(`Session cost from recorded prices is ${costs.sessionCostLabel}.`);
  const bestRound = rounds
    .flatMap((r) => Object.entries(r.scores || {}).map(([slot, score]) => ({ slot, score, q: r.questionIndex })))
    .filter((x) => typeof x.score === 'number')
    .sort((a, b) => b.score - a.score)[0];
  if (bestRound) lines.push(`Highest single score is ${bestRound.score} for slot ${bestRound.slot} on question ${bestRound.q + 1}.`);
  return lines.slice(0, 4);
}

export function reportFilename(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `arena-session-${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}.html`;
}

function sumKnown(values) {
  if (!values.length || values.some((v) => v == null || !Number.isFinite(v))) return null;
  return values.reduce((a, b) => a + b, 0);
}

/** Slots that answered or were scored in any round, in A to D order. One to four. */
export function reportSlots(rounds) {
  return SLOTS.filter((slot) =>
    (rounds || []).some(
      (r) =>
        (r.answers || []).some((a) => a.slot === slot) ||
        (typeof r.scores?.[slot] === 'number' && Number.isFinite(r.scores[slot])),
    ),
  );
}

function standingsFor(list, slots, modelBySlot, costs, totals, categoryRoll) {
  const rows = slots.map((slot) => {
    const ids = [];
    for (const r of list) {
      for (const a of r.answers || []) {
        if (a.slot === slot && a.modelId && !ids.includes(a.modelId)) ids.push(a.modelId);
      }
    }
    if (!ids.length && modelBySlot[slot]) ids.push(modelBySlot[slot]);
    const mine = costs.models.filter((m) => m.slot === slot);
    const scoredRounds = list.filter((r) => typeof r.scores?.[slot] === 'number').length;
    const cost = mine.length && mine.every((m) => m.cost != null) ? sumKnown(mine.map((m) => m.cost)) : null;
    return {
      slot,
      modelLabel: ids.join(', ') || `Contestant ${slot}`,
      scored: scoredRounds > 0,
      total: totals[slot] ?? 0,
      average: scoredRounds ? (totals[slot] ?? 0) / scoredRounds : null,
      categoryTotals: categoryRoll.bySlot[slot] || {},
      promptTokens: sumKnown(mine.map((m) => m.promptTokens)),
      completionTokens: sumKnown(mine.map((m) => m.completionTokens)),
      cachedTokens: sumKnown(mine.map((m) => m.cachedTokens)),
      cost,
      costLabel: cost != null ? formatRunningUsd(cost) : mine.length ? 'cost unknown' : '--',
      rank: 0,
    };
  });
  const ranked = rows.filter((r) => r.scored).sort((a, b) => b.total - a.total);
  ranked.forEach((row, i) => {
    row.rank = i > 0 && ranked[i - 1].total === row.total ? ranked[i - 1].rank : i + 1;
  });
  return [...rows].sort((a, b) => {
    if (a.scored !== b.scored) return a.scored ? -1 : 1;
    return a.scored ? a.rank - b.rank || a.slot.localeCompare(b.slot) : a.slot.localeCompare(b.slot);
  });
}

/**
 * Full session report for one to four contestants as a printable HTML page.
 * @param {{ rounds: object[], modelBySlot?: Record<string, string>, generatedAt?: Date }} opts
 */
export function buildArenaReport({ rounds, modelBySlot = {}, generatedAt = new Date() }) {
  const list = (Array.isArray(rounds) ? rounds : [])
    .slice()
    .sort((a, b) => (a.questionIndex ?? 0) - (b.questionIndex ?? 0));
  const winner = declareArenaWinner(list, modelBySlot);
  const costs = rollupSessionCosts(list);
  const when = formatReportTime(generatedAt);
  const totals = computeTotals(list);
  const categoryRoll = contestCategoryTotals(list);
  const slots = reportSlots(list);
  const standings = standingsFor(list, slots, modelBySlot, costs, totals, categoryRoll);
  const model = {
    when,
    winner,
    bullets: findings(list, winner, costs),
    rounds: list,
    standings,
    categories: categoryRoll.categories,
    sessionCostLabel: costs.sessionCostLabel,
  };
  return {
    winner,
    costs,
    filename: reportFilename(generatedAt),
    html: renderReportHtml(model),
    when,
    slots,
  };
}
