import { describe, expect, it } from 'vitest';
import { buildOpenRouterIndex } from './modelPricing.js';
import {
  declareArenaWinner,
  roundEntryFromMessages,
  rollupSessionCosts,
  buildArenaReport,
  costForRecordedUsage,
  reportSlots,
} from './arenaReport.js';
import { latexToHtml } from './arenaReportMath.js';
import { renderReportText } from './arenaReportHtml.js';

const catalog = {
  index: buildOpenRouterIndex([
    { id: 'x-ai/grok-4.6', pricing: { prompt: '0.000002', completion: '0.000006' } },
  ]),
};

describe('declareArenaWinner', () => {
  it('names a single leader from existing totals', () => {
    const history = [
      { scores: { A: 4, B: 8 } },
      { scores: { A: 5, B: 6 } },
    ];
    const result = declareArenaWinner(history, { A: 'local-a', B: 'grok:grok-4.6' });
    expect(result.tied).toBe(false);
    expect(result.slots).toEqual(['B']);
    expect(result.points).toBe(14);
    expect(result.headline).toContain('Winner: B (grok:grok-4.6)');
  });

  it('names a tie and does not pick one winner', () => {
    const result = declareArenaWinner([{ scores: { A: 7, B: 7, C: 3 } }], { A: 'a', B: 'b' });
    expect(result.tied).toBe(true);
    expect(result.slots).toEqual(['A', 'B']);
    expect(result.headline.startsWith('Tied:')).toBe(true);
    expect(result.headline).toContain('A (a)');
    expect(result.headline).toContain('B (b)');
  });
});

describe('session cost', () => {
  it('uses a recorded price and leaves an unpriced model as cost unknown', () => {
    const priced = costForRecordedUsage('grok:grok-4.6', { prompt: 1000, completion: 500 }, catalog);
    expect(priced.cost).toBeGreaterThan(0);
    const unknown = costForRecordedUsage('nous:stealth/ox-alpha', { prompt: 1000, completion: 500 }, catalog);
    expect(unknown.label).toBe('cost unknown');
    expect(unknown.cost).toBeNull();
    const missing = costForRecordedUsage('grok:grok-4.6', { prompt: null, completion: 10 }, catalog);
    expect(missing.label).toBe('cost unknown');
    const local = costForRecordedUsage('Qwen3.8-Flash-Next', { prompt: null, completion: null }, catalog);
    expect(local.cost).toBe(0);
    expect(local.label).toBe('$0.00');
  });

  it('rolls up per model and keeps the session total unknown if any price is missing', () => {
    const rounds = [
      {
        answers: [
          { slot: 'A', modelId: 'grok:grok-4.6', promptTokens: 1000, completionTokens: 100, cachedTokens: 20, cost: 0.0026 },
          { slot: 'B', modelId: 'mystery', promptTokens: 50, completionTokens: 10, cachedTokens: null, cost: null },
        ],
      },
    ];
    const roll = rollupSessionCosts(rounds);
    expect(roll.models[0].costLabel).not.toBe('cost unknown');
    expect(roll.models[1].costLabel).toBe('cost unknown');
    expect(roll.sessionCost).toBeGreaterThan(0);
    expect(roll.sessionCostLabel).toContain('plus unpriced');
    expect(roll.models[1].cachedTokens).toBeNull();
  });
});

function entryFor(slots, { text = (slot) => `Answer from ${slot}.`, scores, comments, questionIndex = 0, questionText = 'What is two plus two?' } = {}) {
  return roundEntryFromMessages({
    questionIndex,
    questionText,
    scores: scores ?? Object.fromEntries(slots.map((s, i) => [s, 9 - i])),
    comments: comments ?? Object.fromEntries(slots.map((s) => [s, `Comment for ${s}.`])),
    modelBySlot: Object.fromEntries(slots.map((s) => [s, `grok:model-${s}`])),
    catalog,
    slotsWithResponses: slots.map((slot) => ({
      slot,
      msgs: [{ role: 'assistant', content: text(slot), stats: { prompt_tokens: 100, completion_tokens: 20 } }],
    })),
  });
}

const modelBySlot = { A: 'grok:model-A', B: 'grok:model-B', C: 'grok:model-C', D: 'grok:model-D' };

describe('buildArenaReport', () => {
  it('writes an HTML report with the winner, question, answer, comment, and cost unknown', () => {
    const entry = roundEntryFromMessages({
      questionIndex: 0,
      questionText: 'What is two plus two?',
      scores: { A: 9, B: 4 },
      comments: { A: 'Correct and concise.', B: 'Wrong total.' },
      modelBySlot: { A: 'grok:grok-4.6', B: 'nous:mystery-blob' },
      catalog,
      slotsWithResponses: [
        { slot: 'A', msgs: [{ role: 'assistant', content: 'Four.', stats: { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 5 } }] },
        { slot: 'B', msgs: [{ role: 'assistant', content: 'Five.', stats: { prompt_tokens: 80, completion_tokens: 12 } }] },
      ],
    });
    expect(entry.answers[0].cost).toBeGreaterThan(0);
    expect(entry.answers[1].costLabel).toBe('cost unknown');
    expect(entry.answers[1].judgeComment).toBe('Wrong total.');
    const report = buildArenaReport({
      rounds: [entry],
      modelBySlot: { A: 'grok:grok-4.6', B: 'nous:mystery-blob' },
      generatedAt: new Date('2026-09-30T18:00:00Z'),
    });
    expect(report.html.startsWith('<!doctype html>')).toBe(true);
    expect(report.html).toContain('Winner: A (grok:grok-4.6) with 9 points.');
    expect(report.html).toContain('What is two plus two?');
    expect(report.html).toContain('Four.');
    expect(report.html).toContain('Five.');
    expect(report.html).toContain('Correct and concise.');
    expect(report.html).toContain('Wrong total.');
    expect(report.html).toContain('cost unknown');
    expect(report.filename).toMatch(/^arena-session-\d{8}-\d{6}\.html$/);
  });

  it.each([1, 2, 3, 4])('shows every contestant, question, answer, and comment for %i contestant(s)', (count) => {
    const slots = ['A', 'B', 'C', 'D'].slice(0, count);
    const rounds = [0, 1, 2].map((q) =>
      entryFor(slots, {
        questionIndex: q,
        questionText: `Question text number ${q + 1}`,
        text: (slot) => `Full answer ${slot}${q + 1} ${'long '.repeat(3000)}END-${slot}${q + 1}`,
        comments: Object.fromEntries(slots.map((s) => [s, `Scoring comment ${s}${q + 1}`])),
      }),
    );
    const report = buildArenaReport({ rounds, modelBySlot, generatedAt: new Date('2026-09-30T18:00:00Z') });
    expect(report.slots).toEqual(slots);
    for (let q = 1; q <= 3; q++) {
      expect(report.html).toContain(`Question text number ${q}`);
      for (const s of slots) {
        expect(report.html).toContain(`END-${s}${q}`);
        expect(report.html).toContain(`Scoring comment ${s}${q}`);
      }
    }
    expect(report.html.match(/class="card"/g)).toHaveLength(count * 3);
    expect(report.html).toContain(`${count} contestant${count === 1 ? '' : 's'}`);
    expect(report.html).not.toContain('truncated');
  });

  it('describes a single contestant without calling them the winner', () => {
    const report = buildArenaReport({ rounds: [entryFor(['A'])], modelBySlot });
    expect(report.winner.headline).toContain('Single contestant');
    expect(report.winner.headline).not.toContain('Winner:');
  });

  it('keeps ranks and ties in the standings', () => {
    const rounds = [entryFor(['A', 'B', 'C'], { scores: { A: 7, B: 7, C: 3 } })];
    const report = buildArenaReport({ rounds, modelBySlot });
    expect(report.winner.tied).toBe(true);
    expect(report.html).toContain('Tied: A (grok:model-A) and B (grok:model-B) with 7 points each.');
  });

  it('says when the judge gave no comment and when an answer is missing', () => {
    const entry = entryFor(['A'], { comments: {} });
    entry.scores.B = 5;
    const report = buildArenaReport({ rounds: [entry], modelBySlot });
    expect(report.html).toContain('The judge did not return a comment for this answer.');
    expect(report.html).toContain('No answer was recorded for this contestant.');
    expect(reportSlots([entry])).toEqual(['A', 'B']);
  });

  it('keeps accented names and symbols instead of turning them into question marks', () => {
    const entry = entryFor(['A'], {
      questionText: 'Impagliazzo\u2013Wigderson and H\u00e5stad: is PH \u2286 CH?',
      text: () => 'Karp\u2013Lipton: Cram\u00e9r\u2013Rao bound \u2192 done',
    });
    const report = buildArenaReport({ rounds: [entry], modelBySlot });
    expect(report.html).toContain('Impagliazzo\u2013Wigderson');
    expect(report.html).toContain('H\u00e5stad');
    expect(report.html).toContain('Cram\u00e9r\u2013Rao');
    expect(report.html).not.toMatch(/Impagliazzo\?Wigderson/);
  });

  it('does not let model output run script or load remote content', () => {
    const entry = entryFor(['A'], {
      text: () => '<script>alert(1)</script>\n\nText <img src=x onerror=alert(2)> [bad](javascript:alert(3)) ![p](http://evil/x.png) [ok](https://example.com)',
    });
    const report = buildArenaReport({ rounds: [entry], modelBySlot });
    expect(report.html).not.toContain('<script>alert');
    expect(report.html).not.toContain('<img src=x');
    expect(report.html).not.toContain('href="javascript');
    expect(report.html).not.toContain('<a href="http://evil');
    expect(report.html).not.toContain('src="http://evil');
    expect(report.html).toContain('<a href="https://example.com"');
    expect(report.html).toContain("script-src 'nonce-");
  });
});

describe('answer rendering', () => {
  it('renders markdown, math, and svg pictures', () => {
    const html = renderReportText('**bold** and \\(\\mathsf{BPP} \\subseteq \\mathsf{P}/\\mathrm{poly}\\)\n\n```svg\n<svg viewBox="0 0 10 10"><rect/></svg>\n```');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('BPP ⊆ P/poly');
    expect(html).not.toContain('\\mathsf');
    expect(html).toContain('<img class="answer-picture" alt="Picture drawn by the model" src="data:image/svg+xml;base64,');
    expect(html).not.toContain('<svg');
  });

  it('leaves dollar signs in code and prices alone', () => {
    const html = renderReportText('Costs $5 and $10 today. `echo $HOME $USER`');
    expect(html).toContain('$5 and $10');
    expect(html).toContain('echo $HOME $USER');
  });

  it('drops hidden reasoning blocks', () => {
    expect(renderReportText('<think>secret plan</think>Final answer.')).not.toContain('secret plan');
    expect(renderReportText('<think>never closed')).toBe('');
  });
});

describe('latexToHtml', () => {
  it('covers common notation without leaving backslash commands', () => {
    expect(latexToHtml('\\frac{a+b}{2}')).toBe('(a+b)⁄2');
    expect(latexToHtml('\\sqrt{mn}')).toBe('√(mn)');
    expect(latexToHtml('x^2 + y_{i}')).toBe('x<sup>2</sup> + y<sub>i</sub>');
    expect(latexToHtml('\\mathsf{PH}\\subseteq\\mathsf{PSPACE}')).toBe('PH⊆PSPACE');
    expect(latexToHtml('\\mathbb{R}^n \\to \\infty')).toBe('ℝ<sup>n</sup> → ∞');
    expect(latexToHtml('\\left\\langle \\psi \\middle| \\phi \\right\\rangle')).not.toContain('\\');
  });

  it('escapes html inside math', () => {
    expect(latexToHtml('a<b')).toBe('a&lt;b');
  });
});
