import { describe, expect, it } from 'vitest';
import { buildOpenRouterIndex } from './modelPricing.js';
import {
  declareArenaWinner,
  roundEntryFromMessages,
  rollupSessionCosts,
  buildArenaReport,
  compactAnswerExcerpt,
  costForRecordedUsage,
} from './arenaReport.js';

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

describe('buildArenaReport', () => {
  it('writes a PDF that names the winner, the question, and cost unknown', () => {
    const entry = roundEntryFromMessages({
      questionIndex: 0,
      questionText: 'What is two plus two?',
      scores: { A: 9, B: 4 },
      modelBySlot: { A: 'grok:grok-4.6', B: 'nous:mystery-blob' },
      catalog,
      slotsWithResponses: [
        {
          slot: 'A',
          msgs: [{ role: 'assistant', content: 'Four.', stats: { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 5 } }],
        },
        {
          slot: 'B',
          msgs: [{ role: 'assistant', content: 'Five.', stats: { prompt_tokens: 80, completion_tokens: 12 } }],
        },
      ],
    });
    expect(entry.answers[0].cost).toBeGreaterThan(0);
    expect(entry.answers[1].costLabel).toBe('cost unknown');
    expect(entry.answers[1].cachedTokens).toBeNull();
    const report = buildArenaReport({
      rounds: [entry],
      modelBySlot: { A: 'grok:grok-4.6', B: 'nous:mystery-blob' },
      generatedAt: new Date('2026-09-30T18:00:00Z'),
      layout: 'long',
    });
    const text = new TextDecoder().decode(report.pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Winner: A \\(grok:grok-4.6\\)');
    expect(text).toContain('What is two plus two?');
    expect(text).toContain('cost unknown');
    expect(text).toContain('Four.');
    expect(report.filename).toMatch(/^arena-session-\d{8}-\d{6}\.pdf$/);
    const withCat = buildArenaReport({
      rounds: [{ ...entry, category: 'Physics' }, { ...entry, questionIndex: 1, category: 'History', scores: { A: 4, B: 8 } }],
      modelBySlot: { A: 'grok:grok-4.6', B: 'nous:mystery-blob' },
      generatedAt: new Date('2026-09-30T18:00:00Z'),
      layout: 'long',
    });
    const catText = new TextDecoder().decode(withCat.pdf);
    expect(catText).toContain('Physics');
    expect(catText).toContain('History');
    expect(catText).toContain('Contest totals');
  });
});


describe('compact arena report', () => {
  it('defaults to a short table and says picture instead of svg markup', () => {
    const long = 'word '.repeat(200);
    expect(compactAnswerExcerpt('<svg><rect/></svg> caption')).toBe('picture');
    expect(compactAnswerExcerpt(long).endsWith('...')).toBe(true);
    expect(compactAnswerExcerpt(long).length).toBeLessThan(290);
    const entry = roundEntryFromMessages({
      questionIndex: 0,
      questionText: 'What is two plus two?',
      scores: { A: 9 },
      modelBySlot: { A: 'grok:grok-4.6' },
      catalog,
      slotsWithResponses: [
        {
          slot: 'A',
          msgs: [{ role: 'assistant', content: '<svg viewBox="0 0 10 10"><rect/></svg>', stats: { prompt_tokens: 10, completion_tokens: 4 } }],
        },
      ],
    });
    const report = buildArenaReport({
      rounds: [entry],
      modelBySlot: { A: 'grok:grok-4.6' },
      generatedAt: new Date('2026-09-30T18:00:00Z'),
    });
    const text = new TextDecoder().decode(report.pdf);
    expect(report.layout).toBe('compact');
    expect(text).toContain('Summary');
    expect(text).toContain('What is two plus two?');
    expect(text).toContain('picture');
    expect(text).not.toContain('<svg');
    expect(text).not.toContain('Recommendation');
  });
});
