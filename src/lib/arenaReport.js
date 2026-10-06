/**
 * End-of-round arena report. Scores come from the existing judge history.
 * Costs and token counts are copied from message stats and the pricing catalog.
 * Missing prices stay "cost unknown". Nothing is estimated.
 */
import { contentToText, computeTotals, contestCategoryTotals } from '$lib/arenaLogic.js';
import {
  lookupPricing,
  runningCostUsd,
  formatRunningUsd,
  readCachedTokenCount,
  formatTokenCount,
  isLocalAtomModel,
} from '$lib/modelPricing.js';

const ANSWER_LIMIT = 8000;
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
}) {
  const answers = [];
  for (const row of slotsWithResponses || []) {
    const slot = row?.slot;
    if (!SLOTS.includes(slot)) continue;
    const msgs = row.msgs || [];
    const assistant = [...msgs].reverse().find((m) => m && m.role === 'assistant');
    const raw = assistant ? contentToText(assistant.content) : '';
    const truncated = raw.length > ANSWER_LIMIT;
    const stats = assistant?.stats;
    const prompt = tokenOrNull(stats, 'prompt_tokens');
    const completion = tokenOrNull(stats, 'completion_tokens');
    const cached = stats ? readCachedTokenCount(stats) : null;
    const modelId = String(modelBySlot[slot] || assistant?.modelId || '');
    const priced = costForRecordedUsage(modelId, { prompt, completion, cached }, catalog);
    answers.push({
      slot,
      modelId,
      text: truncated ? raw.slice(0, ANSWER_LIMIT) : raw,
      truncated,
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

function numCell(n) {
  return n == null || !Number.isFinite(n) ? '--' : formatTokenCount(n);
}

function findings(rounds, winner, costs) {
  const lines = [];
  lines.push(`${rounds.length} judged question${rounds.length === 1 ? ' is' : 's are'} in this session.`);
  lines.push(winner.headline);
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
  return `arena-session-${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}.pdf`;
}

function escPdf(s) {
  return String(s)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Multi-page Helvetica PDF. Streams are uncompressed so the text is in the file.
 * @param {string[]} lines blocks separated by form-feed \f for a new page, or drawn as flowing text.
 */
export function renderSimplePdf(blocks) {
  const pageW = 612;
  const pageH = 792;
  const margin = 48;
  const pages = [];
  let commands = [];
  let y = pageH - margin;

  function newPage() {
    if (commands.length) pages.push(commands.join('\n'));
    commands = [];
    y = pageH - margin;
  }

  function ensure(h) {
    if (y - h < margin) newPage();
  }

  function text(str, x, size, font, color = '0 0 0') {
    const [r, g, b] = color.split(' ').map(Number);
    commands.push(
      'BT',
      `${r} ${g} ${b} rg`,
      `/${font} ${size} Tf`,
      `1 0 0 1 ${x} ${y} Tm`,
      `(${escPdf(str)}) Tj`,
      'ET',
    );
  }

  function wrap(str, size, width) {
    const max = Math.max(8, Math.floor(width / (size * 0.52)));
    const words = String(str).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > max && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  for (const block of blocks) {
    if (block.type === 'gap') {
      y -= block.h || 8;
      continue;
    }
    if (block.type === 'rule') {
      ensure(8);
      commands.push(`0.75 0.78 0.82 RG`, `${margin} ${y} m ${pageW - margin} ${y} l S`);
      y -= 8;
      continue;
    }
    if (block.type === 'box') {
      const inner = [];
      for (const line of block.lines || []) inner.push(...wrap(line, 10, pageW - margin * 2 - 16));
      const h = 16 + inner.length * 13;
      ensure(h + 4);
      const top = y;
      commands.push(
        '0.93 0.95 0.97 rg',
        `${margin} ${top - h} ${pageW - margin * 2} ${h} re f`,
        '0.15 0.35 0.55 RG',
        `${margin} ${top - h} ${pageW - margin * 2} ${h} re S`,
      );
      y -= 14;
      for (const line of inner) {
        text(line, margin + 8, 10, block.bold ? 'F2' : 'F1', '0.1 0.15 0.22');
        y -= 13;
      }
      y -= 8;
      continue;
    }
    if (block.type === 'h') {
      ensure(22);
      text(block.text, margin, block.size || 14, 'F2', '0.08 0.12 0.2');
      y -= (block.size || 14) + 8;
      continue;
    }
    if (block.type === 'p') {
      let lines = wrap(block.text, 10, pageW - margin * 2);
      const cap = block.maxLines;
      if (cap && lines.length > cap) {
        lines = lines.slice(0, cap);
        const last = lines[cap - 1];
        lines[cap - 1] = (last.length > 3 ? last.slice(0, last.length - 3) : last) + '...';
      }
      for (const line of lines) {
        ensure(13);
        text(line, margin, 10, 'F1', '0.15 0.18 0.22');
        y -= 13;
      }
      y -= 4;
      continue;
    }
    if (block.type === 'wraptable') {
      const cols = block.cols || [];
      const totalW = pageW - margin * 2;
      const sum = cols.reduce((s, c) => s + (c.w || 1), 0) || 1;
      const widths = cols.map((c) => ((c.w || 1) / sum) * totalW);
      const wrapCol = block.wrapCol ?? 2;
      const draw = (cells, header) => {
        const wrapped = cells.map((cell, i) => {
          const raw = String(cell ?? '');
          if (header || i !== wrapCol) return [raw];
          return wrap(raw, 8, Math.max(24, widths[i] - 6));
        });
        const n = Math.max(1, ...wrapped.map((lines) => lines.length));
        const h = 6 + n * 10;
        ensure(h + 2);
        const top = y + 3;
        if (header) {
          commands.push(`0.9 0.92 0.95 rg`, `${margin} ${top - h} ${totalW} ${h} re f`);
        } else {
          commands.push(`0.82 0.85 0.9 RG`, `${margin} ${top - h} ${totalW} ${h} re S`);
        }
        let x = margin;
        const rowY = y;
        wrapped.forEach((lines, i) => {
          lines.forEach((line, li) => {
            y = rowY - li * 10;
            const shown = i === wrapCol && !header
              ? line
              : line.slice(0, Math.max(4, Math.floor(widths[i] / 4.5)));
            text(shown, x + 2, 8, header ? 'F2' : 'F1');
          });
          x += widths[i];
        });
        y = rowY - h;
      };
      draw(cols.map((c) => c.label), true);
      for (const row of block.rows || []) draw(row, false);
      y -= 8;
      continue;
    }
    if (block.type === 'bullet') {
      const lines = wrap(block.text, 10, pageW - margin * 2 - 14);
      lines.forEach((line, i) => {
        ensure(13);
        text(i === 0 ? `- ${line}` : `  ${line}`, margin, 10, 'F1');
        y -= 13;
      });
      continue;
    }
    if (block.type === 'table') {
      const cols = block.cols;
      const rows = block.rows;
      const colW = (pageW - margin * 2) / cols.length;
      const drawRow = (cells, header) => {
        ensure(16);
        const top = y + 3;
        if (header) {
          commands.push(`0.9 0.92 0.95 rg`, `${margin} ${top - 14} ${pageW - margin * 2} 16 re f`);
        }
        cells.forEach((cell, i) => {
          const clipped = String(cell).slice(0, Math.max(4, Math.floor(colW / 5.2)));
          text(clipped, margin + i * colW + 2, 8, header ? 'F2' : 'F1');
        });
        y -= 16;
      };
      drawRow(cols, true);
      for (const row of rows) drawRow(row, false);
      y -= 6;
      continue;
    }
    if (block.type === 'bars') {
      const max = Math.max(1, ...block.items.map((it) => Number(it.value) || 0));
      const barMax = pageW - margin * 2 - 120;
      for (const it of block.items) {
        ensure(18);
        text(String(it.label).slice(0, 18), margin, 9, 'F1');
        const w = Math.max(2, ((Number(it.value) || 0) / max) * barMax);
        commands.push(
          '0.2 0.45 0.72 rg',
          `${margin + 110} ${y - 2} ${w} 10 re f`,
        );
        text(String(it.value), margin + 116 + w, 9, 'F2');
        y -= 18;
      }
      y -= 4;
    }
  }
  if (commands.length) pages.push(commands.join('\n'));
  if (!pages.length) pages.push('BT /F1 12 Tf 48 740 Td (Empty report) Tj ET');

  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  const contentIds = [];
  for (const stream of pages) {
    const content = `<< /Length ${utf8Length(stream)} >>\nstream\n${stream}\nendstream`;
    contentIds.push(add(content));
  }
  for (const cid of contentIds) {
    pageIds.push(
      add(
        `<< /Type /Page /Parent PAGES 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${cid} 0 R >>`,
      ),
    );
  }
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  const pagesId = add(`<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const fixed = objects.map((body) => body.replace('Parent PAGES 0 R', `Parent ${pagesId} 0 R`));
  let out = '%PDF-1.4\n';
  const offsets = [0];
  fixed.forEach((body, i) => {
    offsets.push(utf8Length(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = utf8Length(out);
  out += `xref\n0 ${fixed.length + 1}\n`;
  out += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${fixed.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function utf8Length(s) {
  return new TextEncoder().encode(s).length;
}

export const COMPACT_EXCERPT = 280;

/** Short cell for the compact table. An svg is "picture", not markup. */
export function compactAnswerExcerpt(text) {
  const raw = String(text || '');
  if (/<svg\b/i.test(raw)) return 'picture';
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (!flat) return '--';
  if (flat.length <= COMPACT_EXCERPT) return flat;
  return flat.slice(0, COMPACT_EXCERPT) + '...';
}

export function clipReportQuestion(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim() || 'No question text was stored.';
  if (flat.length <= 180) return flat;
  return flat.slice(0, 180).replace(/\s+\S*$/, '') + '...';
}

function longReportBlocks({ list, modelBySlot, winner, costs, when, bullets, totals, categoryRoll, scoredSlots }) {
  const blocks = [
    { type: 'h', text: 'ATOM Arena session report', size: 16 },
    { type: 'p', text: `${when}. This printout uses the scores the judge already recorded and the token counts stored on those answers.` },
    {
      type: 'box',
      bold: true,
      lines: [
        'Summary',
        winner.headline,
        `Questions judged: ${list.length}. Session cost: ${costs.sessionCostLabel}.`,
      ],
    },
    { type: 'h', text: 'Recommendation', size: 13 },
    {
      type: 'p',
      text: winner.tied
        ? `${winner.headline} Do not treat one of them as the sole winner. The totals are the same, so the result is a tie.`
        : winner.slots.length
          ? `${winner.headline} That slot leads on the sum of the judge scores from this session.`
          : 'Judging did not produce scores, so there is no winner to recommend.',
    },
    { type: 'h', text: 'Key findings', size: 13 },
    ...bullets.map((text) => ({ type: 'bullet', text })),
    { type: 'h', text: 'Models', size: 13 },
    {
      type: 'table',
      cols: ['Slot', 'Model'],
      rows: SLOTS.filter((s) => modelBySlot[s] || scoredSlots.includes(s)).map((s) => [s, modelBySlot[s] || '--']),
    },
    { type: 'h', text: 'Cost', size: 13 },
    {
      type: 'p',
      text: 'Costs use the prices already loaded for each model. Cache tokens are not added on top of input. A blank price stays cost unknown.',
    },
    {
      type: 'table',
      cols: ['Model', 'In', 'Out', 'Cache', 'Cost'],
      rows: [
        ...costs.models.map((m) => [
          `${m.slot} ${m.modelId || ''}`.trim(),
          numCell(m.promptTokens),
          numCell(m.completionTokens),
          numCell(m.cachedTokens),
          m.costLabel,
        ]),
        ['Session total', '--', '--', '--', costs.sessionCostLabel],
      ],
    },
    { type: 'h', text: 'Contest totals', size: 13 },
    {
      type: 'p',
      text: 'Each number is the sum of the judge scores already recorded for that contestant. A question scored again replaces that question. It is not added twice.',
    },
    {
      type: 'table',
      cols: ['Contestant', ...(categoryRoll.categories.length ? categoryRoll.categories : []), 'Total'],
      rows: scoredSlots.map((s) => [
        `${s} ${modelBySlot[s] || ''}`.trim(),
        ...categoryRoll.categories.map((cat) =>
          categoryRoll.bySlot[s]?.[cat] != null ? String(categoryRoll.bySlot[s][cat]) : '--',
        ),
        String(totals[s] ?? 0),
      ]),
    },
    { type: 'h', text: 'Score chart', size: 13 },
    {
      type: 'bars',
      items: scoredSlots.map((s) => ({
        label: `${s} ${modelBySlot[s] || ''}`.trim(),
        value: totals[s] ?? 0,
      })),
    },
    { type: 'h', text: 'Scores by question', size: 13 },
    {
      type: 'table',
      cols: ['Q', ...scoredSlots],
      rows: list.map((r) => [
        String((r.questionIndex ?? 0) + 1),
        ...scoredSlots.map((s) => (typeof r.scores?.[s] === 'number' ? String(r.scores[s]) : '--')),
      ]),
    },
  ];

  list.forEach((round, i) => {
    blocks.push({ type: 'h', text: `Question ${i + 1}`, size: 13 });
    blocks.push({
      type: 'p',
      text: round.questionText || 'No question text was stored.',
    });
    blocks.push({
      type: 'table',
      cols: ['Slot', 'Score', 'In', 'Out', 'Cache', 'Cost'],
      rows: (round.answers || []).map((a) => [
        a.slot,
        typeof round.scores?.[a.slot] === 'number' ? String(round.scores[a.slot]) : '--',
        numCell(a.promptTokens),
        numCell(a.completionTokens),
        numCell(a.cachedTokens),
        a.costLabel || 'cost unknown',
      ]),
    });
    for (const a of round.answers || []) {
      const note = a.truncated ? ' Answer truncated because it was very long.' : '';
      const body = (a.text || '').replace(/\s+/g, ' ').trim() || '(no answer text stored)';
      blocks.push({
        type: 'p',
        text: `${a.slot} ${a.modelId || ''}: ${body.slice(0, 700)}${body.length > 700 || a.truncated ? '...' : ''}${note}`,
      });
    }
  });

  return blocks;
}

function compactReportBlocks({ list, modelBySlot, winner, costs, when }) {
  const blocks = [
    { type: 'h', text: 'ATOM Arena session report', size: 14 },
    {
      type: 'box',
      bold: true,
      lines: [
        'Summary',
        winner.headline,
        `${when}. Cost total: ${costs.sessionCostLabel}.`,
      ],
    },
  ];
  list.forEach((round, i) => {
    blocks.push({ type: 'h', text: `Question ${i + 1}`, size: 12 });
    blocks.push({ type: 'p', text: clipReportQuestion(round.questionText), maxLines: 2 });
    blocks.push({
      type: 'wraptable',
      wrapCol: 2,
      cols: [
        { label: 'Model', w: 16 },
        { label: 'Score', w: 6 },
        { label: 'Answer', w: 34 },
        { label: 'In', w: 7 },
        { label: 'Out', w: 7 },
        { label: 'Cache', w: 8 },
        { label: 'Cost', w: 12 },
      ],
      rows: (round.answers || []).map((a) => [
        `${a.slot} ${a.modelId || ''}`.trim(),
        typeof round.scores?.[a.slot] === 'number' ? String(round.scores[a.slot]) : '--',
        compactAnswerExcerpt(a.text),
        numCell(a.promptTokens),
        numCell(a.completionTokens),
        numCell(a.cachedTokens),
        a.costLabel || 'cost unknown',
      ]),
    });
  });
  return blocks;
}

export function buildArenaReport({ rounds, modelBySlot = {}, generatedAt = new Date(), layout = 'compact' }) {
  const list = Array.isArray(rounds) ? rounds : [];
  const mode = layout === 'long' ? 'long' : 'compact';
  const winner = declareArenaWinner(list, modelBySlot);
  const costs = rollupSessionCosts(list);
  const when = formatReportTime(generatedAt);
  const bullets = findings(list, winner, costs);
  const totals = computeTotals(list);
  const categoryRoll = contestCategoryTotals(list);
  const scoredSlots = SLOTS.filter((s) => list.some((r) => typeof r.scores?.[s] === 'number'));
  const shared = { list, modelBySlot, winner, costs, when, bullets, totals, categoryRoll, scoredSlots };
  const blocks = mode === 'long' ? longReportBlocks(shared) : compactReportBlocks(shared);
  const pdf = renderSimplePdf(blocks);
  return { winner, costs, filename: reportFilename(generatedAt), pdf, when, layout: mode };
}
