
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendArenaRecord, readArenaRows, rowsForJudgedRound } from './arenaRecordStore.js';

describe('arena model record', () => {
  it('appends scored rows, leaves unknown cost null, and ranks from every test', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-record-'));
    const dbPath = path.join(dir, 'arena-models.sqlite');
    const first = rowsForJudgedRound({
      entry: {
        questionText: 'What is two plus two?',
        category: 'Math',
        scores: { A: 9, B: 4 },
        answers: [
          { slot: 'A', modelId: 'grok:grok-4.6', text: 'Four.', promptTokens: 10, completionTokens: 2, cachedTokens: null, cost: 0.01 },
          { slot: 'B', modelId: 'mystery', text: '<svg></svg>', promptTokens: null, completionTokens: null, cachedTokens: null, cost: null },
        ],
      },
      layout: 'compact',
      startedAt: '2026-09-30T18:00:00.000Z',
      nameForId: (id) => (id === 'grok:grok-4.6' ? 'Grok' : id),
    });
    expect(first.entries[1].cost).toBeNull();
    expect(first.entries[1].score).toBe(4);
    expect(first.entries[1].had_svg).toBe(1);
    expect(first.entries[1].tokens_in).toBeNull();
    appendArenaRecord(dbPath, first);
    appendArenaRecord(dbPath, rowsForJudgedRound({
      entry: {
        questionText: 'Name a poet.',
        category: 'History',
        scores: { A: 5, B: 8 },
        answers: [
          { slot: 'A', modelId: 'grok:grok-4.6', text: 'Frost.', promptTokens: 8, completionTokens: 2, cachedTokens: 1, cost: 0.02 },
          { slot: 'B', modelId: 'mystery', text: 'Dickinson.', promptTokens: 8, completionTokens: 3, cachedTokens: 0, cost: 0 },
        ],
      },
      layout: 'long',
      startedAt: '2026-09-30T19:00:00.000Z',
    }));
    expect(readArenaRows(dbPath, 'SELECT COUNT(*) AS n FROM tests')[0].n).toBe(2);
    expect(readArenaRows(dbPath, 'SELECT COUNT(*) AS n FROM scores')[0].n).toBe(4);
    const rank = readArenaRows(dbPath, 'SELECT rank, model_id, mean_score, mean_rank, win_rate, test_count FROM master_ranking ORDER BY rank, model_id');
    expect(rank.map((r) => r.model_id)).toEqual(['grok:grok-4.6', 'mystery']);
    expect(rank[0].rank).toBe(1);
    expect(rank[0].mean_score).toBe(7);
    expect(rank[0].test_count).toBe(2);
    expect(rank[0].win_rate).toBe(0.5);
    expect(rank[1].mean_score).toBe(6);
    const types = readArenaRows(dbPath, 'SELECT model_id, test_type, test_count FROM model_strength_by_type ORDER BY test_type, model_id');
    expect(types.map((r) => r.test_type)).toEqual(['History', 'History', 'Math', 'Math']);
    const missing = rowsForJudgedRound({
      entry: { questionText: 'No score', scores: {}, answers: [{ slot: 'A', modelId: 'plain', text: 'x', cost: null }] },
    });
    expect(missing.entries[0].score).toBeNull();
    const code = rowsForJudgedRound({
      entry: {
        questionText: 'Write a loop',
        scores: { A: 6 },
        answers: [{ slot: 'A', modelId: 'grok:grok-4.6', text: 'for (;;) {}', cost: null }],
      },
      arena: 'code',
    });
    expect(code.test_type).toBe('code');
    expect(code.entries[0].test_type).toBe('code');
    expect(code.entries[0].context_bucket == null || typeof code.entries[0].context_bucket === 'string').toBe(true);
  });

  it('gives tied mean scores the same rank', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-tie-'));
    const dbPath = path.join(dir, 'arena-models.sqlite');
    appendArenaRecord(dbPath, rowsForJudgedRound({
      entry: {
        questionText: 'Q',
        scores: { A: 8, B: 8 },
        answers: [
          { slot: 'A', modelId: 'alpha', text: 'a', cost: null },
          { slot: 'B', modelId: 'beta', text: 'b', cost: null },
        ],
      },
    }));
    const rank = readArenaRows(dbPath, 'SELECT rank, model_id FROM master_ranking ORDER BY model_name');
    expect(rank.map((r) => r.rank)).toEqual([1, 1]);
  });
});
