/**
 * HTML renderer for the arena session report.
 * The page prints to a real PDF from the browser, so Unicode, tables, and page breaks
 * come from the browser instead of a hand-written PDF writer.
 * Model output is untrusted: raw HTML is escaped, links are limited to http(s)/mailto,
 * and the page carries a CSP. SVG pictures are shown through <img data:> so they cannot run script.
 */
import { Marked } from 'marked';
import { escapeHtml, extractMath, restoreMath } from '$lib/arenaReportMath.js';

const SLOT_COLORS = { A: '#2563eb', B: '#d97706', C: '#059669', D: '#7c3aed' };

const reportMarkdown = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    image({ text }) {
      return escapeHtml(text || 'image');
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!/^(?:https?:|mailto:)/i.test(String(href || '').trim())) return inner;
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${t} rel="noopener noreferrer">${inner}</a>`;
    },
  },
});

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function svgDataUri(svg) {
  const withNs = /\bxmlns\s*=/.test(svg.slice(0, 400))
    ? svg
    : svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;base64,${toBase64Utf8(withNs)}`;
}

function stripThinking(text) {
  return String(text || '')
    .replace(/<(think|reasoning|thought)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:think|reasoning|thought)>[\s\S]*$/i, '')
    .trim();
}

/**
 * Markdown, math, and SVG pictures from model text, as safe HTML.
 * @param {string} raw
 */
export function renderReportText(raw) {
  let text = stripThinking(raw);
  if (!text) return '';
  const pictures = [];
  text = text.replace(/(?:```[A-Za-z]*[ \t]*\n)?(<svg\b[\s\S]*?<\/svg>)(?:[ \t]*\n?```)?/gi, (_, svg) => {
    pictures.push(svgDataUri(svg));
    return `\n\n@@SVG${pictures.length - 1}@@\n\n`;
  });

  const mathSpans = [];
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  const prepared = parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      const { text: replaced, spans } = extractMath(part);
      const offset = mathSpans.length;
      mathSpans.push(...spans);
      return offset === 0 || !spans.length
        ? replaced
        : replaced.replace(/@@MATH(\d+)@@/g, (_, n) => `@@MATH${Number(n) + offset}@@`);
    })
    .join('');

  let html = reportMarkdown.parse(prepared, { async: false });
  html = restoreMath(html, mathSpans);
  html = html.replace(/@@SVG(\d+)@@/g, (whole, n) => {
    const src = pictures[Number(n)];
    return src ? `<img class="answer-picture" alt="Picture drawn by the model" src="${src}">` : whole;
  });
  return html;
}

function numCell(n) {
  return n == null || !Number.isFinite(n) ? '--' : Number(n).toLocaleString('en-US');
}

function slotBadge(slot) {
  const color = SLOT_COLORS[slot] || '#475569';
  return `<span class="badge" style="background:${color}">${escapeHtml(slot)}</span>`;
}

function scoreText(score) {
  return typeof score === 'number' && Number.isFinite(score) ? `${score}/10` : 'not scored';
}

function renderStandings(model) {
  const categoryHead = model.categories.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join('');
  const rows = model.standings
    .map((s) => {
      const cats = model.categories
        .map((c) => `<td class="num">${s.categoryTotals[c] != null ? s.categoryTotals[c] : '--'}</td>`)
        .join('');
      return `<tr>
        <td class="num">${s.scored ? s.rank : '--'}</td>
        <td>${slotBadge(s.slot)}</td>
        <td class="model">${escapeHtml(s.modelLabel)}</td>
        ${cats}
        <td class="num strong">${s.total}</td>
        <td class="num">${s.average != null ? s.average.toFixed(2) : '--'}</td>
        <td class="num">${numCell(s.promptTokens)}</td>
        <td class="num">${numCell(s.completionTokens)}</td>
        <td class="num">${numCell(s.cachedTokens)}</td>
        <td class="cost">${escapeHtml(s.costLabel)}</td>
      </tr>`;
    })
    .join('');
  const max = Math.max(1, ...model.standings.map((s) => s.total));
  const bars = model.standings
    .filter((s) => s.scored)
    .map((s) => {
      const color = SLOT_COLORS[s.slot] || '#475569';
      const width = Math.max(1, Math.round((s.total / max) * 100));
      return `<div class="bar-row">
        <div class="bar-label">${slotBadge(s.slot)} <span>${escapeHtml(s.modelLabel)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${color}"></div></div>
        <div class="bar-value">${s.total}</div>
      </div>`;
    })
    .join('');
  return `<table class="grid">
    <thead><tr><th class="num">Rank</th><th>Slot</th><th>Model</th>${categoryHead}<th class="num">Points</th><th class="num">Avg</th><th class="num">In</th><th class="num">Out</th><th class="num">Cache</th><th>Cost</th></tr></thead>
    <tbody>${rows}
      <tr class="total-row"><td colspan="${3 + model.categories.length + 6}">Session cost: ${escapeHtml(model.sessionCostLabel)}</td></tr>
    </tbody>
  </table>
  <div class="bars">${bars}</div>`;
}

function renderMatrix(model) {
  const bySlot = [...model.standings].sort((a, b) => a.slot.localeCompare(b.slot));
  const head = bySlot.map((s) => `<th class="num">${slotBadge(s.slot)}</th>`).join('');
  const rows = model.rounds
    .map((r, i) => {
      const cells = bySlot
        .map((s) => `<td class="num">${typeof r.scores?.[s.slot] === 'number' ? r.scores[s.slot] : '--'}</td>`)
        .join('');
      const cat = r.category ? ` <span class="muted">(${escapeHtml(r.category)})</span>` : '';
      return `<tr><td>Question ${i + 1}${cat}</td>${cells}</tr>`;
    })
    .join('');
  const totals = bySlot.map((s) => `<td class="num strong">${s.total}</td>`).join('');
  return `<table class="grid compact-table">
    <thead><tr><th>Question</th>${head}</tr></thead>
    <tbody>${rows}<tr class="total-row"><td>Total</td>${totals}</tr></tbody>
  </table>`;
}

function renderAnswerCard(round, slot, answer) {
  const color = SLOT_COLORS[slot] || '#475569';
  const score = round.scores?.[slot];
  const modelId = answer?.modelId || '';
  if (!answer) {
    return `<section class="card" style="border-left-color:${color}">
      <header class="card-head">${slotBadge(slot)}<span class="card-model">${escapeHtml(modelId || `Contestant ${slot}`)}</span><span class="score">${escapeHtml(scoreText(score))}</span></header>
      <p class="muted">No answer was recorded for this contestant.</p>
    </section>`;
  }
  const body = renderReportText(answer.text) || '<p class="muted">(no answer text stored)</p>';
  const comment = String(answer.judgeComment || '').trim();
  const commentHtml = comment
    ? `<div class="comment"><div class="comment-title">Judge scoring comment</div>${renderReportText(comment)}</div>`
    : `<div class="comment none"><div class="comment-title">Judge scoring comment</div><p class="muted">The judge did not return a comment for this answer.</p></div>`;
  return `<section class="card" style="border-left-color:${color}">
    <header class="card-head">
      ${slotBadge(slot)}
      <span class="card-model">${escapeHtml(modelId || `Contestant ${slot}`)}</span>
      <span class="score">${escapeHtml(scoreText(score))}</span>
    </header>
    <div class="usage">In ${numCell(answer.promptTokens)} &middot; Out ${numCell(answer.completionTokens)} &middot; Cache ${numCell(answer.cachedTokens)} &middot; ${escapeHtml(answer.costLabel && answer.costLabel !== 'cost unknown' ? `Cost ${answer.costLabel}` : 'cost unknown')}</div>
    <div class="answer">${body}</div>
    ${commentHtml}
  </section>`;
}

function renderRound(round, index, slots) {
  const bySlot = new Map((round.answers || []).map((a) => [a.slot, a]));
  const cat = round.category ? `<span class="category">${escapeHtml(round.category)}</span>` : '';
  const question = renderReportText(round.questionText) || '<p class="muted">No question text was stored.</p>';
  const cards = slots.map((slot) => renderAnswerCard(round, slot, bySlot.get(slot))).join('');
  return `<article class="round">
    <h2 class="round-title">Question ${index + 1}${cat}</h2>
    <div class="question">${question}</div>
    ${cards}
  </article>`;
}

const STYLE = `
@page { size: Letter; margin: 0.6in; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 11pt/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111827; background: #f3f4f6; }
.page { max-width: 8.5in; margin: 0 auto; padding: 0.5in 0.6in; background: #fff; }
.toolbar { position: sticky; top: 0; z-index: 5; display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 10px 16px; background: #111827; color: #fff; font-size: 13px; }
.toolbar button { font: inherit; font-weight: 600; padding: 7px 14px; border: 0; border-radius: 6px; background: #3b82f6; color: #fff; cursor: pointer; }
h1 { margin: 0 0 4px; font-size: 22pt; line-height: 1.2; }
h2 { font-size: 14pt; margin: 22px 0 8px; }
h3 { font-size: 12pt; margin: 14px 0 6px; }
.meta { color: #4b5563; margin: 0 0 14px; font-size: 10pt; }
.muted { color: #6b7280; }
.summary { border: 1.5px solid #1d4ed8; background: #eff6ff; border-radius: 8px; padding: 12px 16px; margin: 12px 0 8px; break-inside: avoid; }
.summary .headline { font-size: 13pt; font-weight: 700; margin: 0 0 6px; }
.summary ul { margin: 4px 0 0; padding-left: 20px; }
table.grid { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 8px 0; }
table.grid th, table.grid td { border: 1px solid #d1d5db; padding: 4px 5px; text-align: left; vertical-align: top; overflow-wrap: break-word; }
table.grid thead th { background: #e5e7eb; }
table.grid thead { display: table-header-group; }
table.grid tr { break-inside: avoid; }
.num { text-align: right !important; font-variant-numeric: tabular-nums; white-space: nowrap; }
.strong { font-weight: 700; }
.total-row td { background: #f9fafb; font-weight: 600; }
.cost { min-width: 0.6in; }
.model { min-width: 1.4in; overflow-wrap: anywhere; }
.badge { display: inline-block; min-width: 22px; padding: 1px 7px; border-radius: 999px; color: #fff; font-weight: 700; font-size: 9.5pt; text-align: center; }
.bars { margin: 10px 0 4px; break-inside: avoid; }
.bar-row { display: grid; grid-template-columns: 38% 1fr 36px; gap: 8px; align-items: center; margin: 4px 0; font-size: 9.5pt; }
.bar-label { overflow-wrap: anywhere; }
.bar-track { background: #e5e7eb; height: 12px; border-radius: 6px; overflow: hidden; }
.bar-fill { height: 100%; }
.bar-value { text-align: right; font-weight: 700; }
.round { margin-top: 26px; }
.round-title { display: flex; gap: 10px; align-items: baseline; margin: 0 0 8px; padding-bottom: 4px; border-bottom: 2px solid #111827; break-after: avoid; }
.category { font-size: 9.5pt; font-weight: 600; color: #374151; background: #e5e7eb; border-radius: 4px; padding: 1px 8px; }
.question { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 14px; margin-bottom: 12px; }
.question > :first-child { margin-top: 4px; }
.question > :last-child { margin-bottom: 4px; }
.card { border: 1px solid #d1d5db; border-left: 5px solid #475569; border-radius: 6px; padding: 8px 14px 10px; margin: 12px 0; }
.card-head { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; break-after: avoid; }
.card-model { font-weight: 600; flex: 1; overflow-wrap: anywhere; }
.score { font-weight: 700; font-size: 12pt; white-space: nowrap; }
.usage { color: #6b7280; font-size: 9pt; margin-bottom: 6px; break-after: avoid; }
.answer { overflow-wrap: anywhere; }
.answer p, .question p, .comment p { margin: 0.5em 0; }
.answer pre, .question pre { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; padding: 8px 10px; font-size: 9pt; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer code, .question code, .comment code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.92em; background: #f3f4f6; padding: 0 3px; border-radius: 3px; }
.answer pre code, .question pre code { background: none; padding: 0; }
.answer table, .question table { border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; }
.answer th, .answer td, .question th, .question td { border: 1px solid #d1d5db; padding: 3px 7px; }
.answer blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #d1d5db; color: #374151; }
.answer-picture { max-width: 100%; max-height: 5in; border: 1px solid #e5e7eb; background: #fff; }
.math { font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif; font-style: italic; white-space: nowrap; }
.math-display { font-family: "Cambria Math", "STIX Two Math", "Times New Roman", serif; font-style: italic; text-align: center; margin: 8px 0; overflow-wrap: anywhere; }
.comment { margin-top: 10px; padding: 8px 12px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; break-inside: avoid; }
.comment.none { background: #f9fafb; border-color: #e5e7eb; }
.comment-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #92400e; }
.comment.none .comment-title { color: #6b7280; }
.footer { margin-top: 28px; padding-top: 8px; border-top: 1px solid #d1d5db; color: #6b7280; font-size: 9pt; }
.empty { padding: 24px 0; color: #6b7280; }
@media print {
  body { background: #fff; }
  .page { max-width: none; padding: 0; }
  .no-print { display: none !important; }
}
`;

function newNonce() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {object} model prepared by buildArenaReport
 * @returns {string} complete HTML document
 */
export function renderReportHtml(model) {
  const nonce = newNonce();
  const slotCount = model.standings.length;
  const contestants = `${slotCount} contestant${slotCount === 1 ? '' : 's'}`;
  const bullets = model.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const body = model.rounds.length
    ? `<h2>Standings</h2>${renderStandings(model)}
       <h2>Scores by question</h2>${renderMatrix(model)}
       <h2>Questions, answers, and scoring comments</h2>
       ${model.rounds.map((r, i) => renderRound(r, i, model.standings.map((s) => s.slot).sort())).join('')}`
    : '<p class="empty">No judged questions are in this session yet.</p>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ATOM Arena session report</title>
<style>${STYLE}</style>
</head>
<body>
<div class="toolbar no-print">
  <span>Choose &ldquo;Save as PDF&rdquo; as the destination in the print dialog.</span>
  <button type="button" id="print-report">Print / Save as PDF</button>
</div>
<main class="page">
  <h1>ATOM Arena session report</h1>
  <p class="meta">${escapeHtml(model.when)} &middot; ${escapeHtml(contestants)} &middot; ${model.rounds.length} judged question${model.rounds.length === 1 ? '' : 's'}</p>
  <div class="summary">
    <p class="headline">${escapeHtml(model.winner.headline)}</p>
    <ul>${bullets}</ul>
  </div>
  ${body}
  <p class="footer">Scores and comments are the judge's own, copied as recorded. Token counts come from each answer's stats. Prices come from the loaded pricing catalog. A missing price stays "cost unknown" and nothing is estimated. Answers are shown in full.</p>
</main>
<script nonce="${nonce}">document.getElementById('print-report').addEventListener('click', function () { window.print(); });</script>
</body>
</html>`;
}
