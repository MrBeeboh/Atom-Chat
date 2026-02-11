import { describe, it, expect } from 'vitest';
import {
  parseQuestionsAndAnswers,
  parseJudgeScores,
  stripThinkBlocks,
  detectLoop,
  contentToText,
  arenaStandingLabel,
  buildJudgePrompt,
  addScoreRound,
  computeTotals,
  migrateOldQuestionsAndAnswers,
} from './arenaLogic.js';

// ---------- parseQuestionsAndAnswers ----------
describe('parseQuestionsAndAnswers', () => {
  it('returns empty arrays for empty input', () => {
    expect(parseQuestionsAndAnswers('')).toEqual({ questions: [], answers: [] });
    expect(parseQuestionsAndAnswers(null)).toEqual({ questions: [], answers: [] });
    expect(parseQuestionsAndAnswers(undefined)).toEqual({ questions: [], answers: [] });
  });

  it('parses questions without answers', () => {
    const text = '1. What is 2+2?\n2. Name the capital of France';
    const result = parseQuestionsAndAnswers(text);
    expect(result.questions).toEqual(['What is 2+2?', 'Name the capital of France']);
    expect(result.answers).toEqual(['', '']);
  });

  it('parses questions with answers', () => {
    const text = '1. What is 2+2?\nAnswer: 4\n\n2. Capital of France?\nAnswer: Paris';
    const result = parseQuestionsAndAnswers(text);
    expect(result.questions).toEqual(['What is 2+2?', 'Capital of France?']);
    expect(result.answers).toEqual(['4', 'Paris']);
  });

  it('handles mixed questions (some with answers, some without)', () => {
    const text = '1. Question one\nAnswer: Answer one\n\n2. Question two\n\n3. Question three\nAnswer: Answer three';
    const result = parseQuestionsAndAnswers(text);
    expect(result.questions).toHaveLength(3);
    expect(result.answers[0]).toBe('Answer one');
    expect(result.answers[1]).toBe('');
    expect(result.answers[2]).toBe('Answer three');
  });

  it('handles parenthetical numbering (1) instead of 1.)', () => {
    const text = '1) What is water?\nAnswer: H2O\n\n2) What is fire?';
    const result = parseQuestionsAndAnswers(text);
    expect(result.questions).toEqual(['What is water?', 'What is fire?']);
    expect(result.answers).toEqual(['H2O', '']);
  });

  it('handles multi-line answers', () => {
    const text = '1. Explain gravity\nAnswer: Gravity is a force.\nIt pulls objects together.';
    const result = parseQuestionsAndAnswers(text);
    expect(result.answers[0]).toContain('Gravity is a force.');
    expect(result.answers[0]).toContain('It pulls objects together.');
  });
});

// ---------- parseJudgeScores ----------
describe('parseJudgeScores', () => {
  it('returns empty object for empty input', () => {
    expect(parseJudgeScores('')).toEqual({});
    expect(parseJudgeScores(null)).toEqual({});
  });

  it('parses standard format', () => {
    const text = 'Model B: 7/10 - Good answer\nModel C: 5/10 - Average\nModel D: 9/10 - Excellent';
    expect(parseJudgeScores(text)).toEqual({ B: 7, C: 5, D: 9 });
  });

  it('parses with extra whitespace', () => {
    const text = 'Model  B:  8 / 10 - reason\nModel C: 6/10 - reason';
    expect(parseJudgeScores(text)).toEqual({ B: 8, C: 6 });
  });

  it('ignores Model A scores', () => {
    const text = 'Model A: 10/10 - judge\nModel B: 7/10 - ok';
    expect(parseJudgeScores(text)).toEqual({ B: 7 });
  });

  it('handles only 2 models', () => {
    const text = 'Model B: 8/10 - great\nModel C: 3/10 - poor';
    expect(parseJudgeScores(text)).toEqual({ B: 8, C: 3 });
  });

  it('clamps scores 0-10', () => {
    const text = 'Model B: 0/10 - terrible';
    expect(parseJudgeScores(text)).toEqual({ B: 0 });
  });

  it('strips <think> blocks before parsing', () => {
    const text = '<think>\nLet me analyze this carefully...\nModel B seems to have...\n</think>\nModel B: 8/10 - Good\nModel C: 6/10 - OK';
    expect(parseJudgeScores(text)).toEqual({ B: 8, C: 6 });
  });

  it('handles <think> blocks with scores mentioned inside (should ignore those)', () => {
    const text = '<think>Model B deserves a 3/10 because... but wait, actually 7/10</think>\nModel B: 7/10 - Correct\nModel C: 5/10 - Partial';
    expect(parseJudgeScores(text)).toEqual({ B: 7, C: 5 });
  });

  it('handles multiple <think> blocks', () => {
    const text = '<think>thinking 1</think>\n<think>thinking 2</think>\nModel B: 9/10 - Great';
    expect(parseJudgeScores(text)).toEqual({ B: 9 });
  });
});

// ---------- stripThinkBlocks ----------
describe('stripThinkBlocks', () => {
  it('removes <think> blocks', () => {
    expect(stripThinkBlocks('<think>internal reasoning</think>Model B: 8/10')).toBe('Model B: 8/10');
  });

  it('handles multi-line think blocks', () => {
    expect(stripThinkBlocks('<think>\nline 1\nline 2\n</think>\nResult')).toBe('Result');
  });

  it('passes through text without think blocks', () => {
    expect(stripThinkBlocks('Model B: 7/10 - Good')).toBe('Model B: 7/10 - Good');
  });

  it('handles empty/null input', () => {
    expect(stripThinkBlocks('')).toBe('');
    expect(stripThinkBlocks(null)).toBe('');
  });
});

// ---------- detectLoop ----------
describe('detectLoop', () => {
  it('returns false for short content', () => {
    expect(detectLoop('hello')).toBe(false);
    expect(detectLoop('a'.repeat(100))).toBe(false);
  });

  it('returns false for non-repeating content', () => {
    expect(detectLoop('a'.repeat(100) + 'b'.repeat(100) + 'c'.repeat(100))).toBe(false);
  });

  it('detects repeating tail', () => {
    const repeated = 'This is a repeating pattern that keeps going on and on and on and on and on repeat.';
    const content = 'start' + repeated + repeated + repeated;
    expect(detectLoop(content)).toBe(true);
  });
});

// ---------- contentToText ----------
describe('contentToText', () => {
  it('passes through strings', () => {
    expect(contentToText('hello')).toBe('hello');
  });

  it('extracts text from array parts', () => {
    const arr = [
      { type: 'text', text: 'Hello' },
      { type: 'image_url', image_url: { url: 'data:...' } },
      { type: 'text', text: 'World' },
    ];
    expect(contentToText(arr)).toBe('Hello\nWorld');
  });

  it('returns empty string for other types', () => {
    expect(contentToText(null)).toBe('');
    expect(contentToText(123)).toBe('');
  });
});

// ---------- arenaStandingLabel ----------
describe('arenaStandingLabel', () => {
  it('returns Leader for highest score', () => {
    expect(arenaStandingLabel('B', { B: 10, C: 5, D: 3 })).toBe('Leader');
  });

  it('returns 2nd for second highest', () => {
    expect(arenaStandingLabel('C', { B: 10, C: 5, D: 3 })).toBe('2nd');
  });

  it('returns 3rd for lowest', () => {
    expect(arenaStandingLabel('D', { B: 10, C: 5, D: 3 })).toBe('3rd');
  });

  it('handles tied scores', () => {
    const label = arenaStandingLabel('B', { B: 5, C: 5, D: 5 });
    expect(['Leader', '2nd', '3rd']).toContain(label);
  });
});

// ---------- buildJudgePrompt ----------
describe('buildJudgePrompt', () => {
  const baseMsgs = [
    { slot: 'B', msgs: [{ role: 'user', content: 'What is 2+2?' }, { role: 'assistant', content: '4' }] },
    { slot: 'C', msgs: [{ role: 'user', content: 'What is 2+2?' }, { role: 'assistant', content: 'Four' }] },
  ];

  it('builds messages with answer key', () => {
    const { messages } = buildJudgePrompt({
      slotsWithResponses: baseMsgs,
      answerKeyTrimmed: '4',
      judgeWebContext: '',
      promptText: 'What is 2+2?',
      judgeFeedback: '',
      judgeInstructions: '',
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const content = messages.map((m) => m.content).join('\n');
    expect(content).toContain('ANSWER KEY');
    expect(content).toContain('Model B');
    expect(content).toContain('Model C');
    // Should instruct judge to ignore capitalization/formatting
    expect(content).toContain('SUBSTANTIVELY CORRECT');
    expect(content).toContain('capitalization');
  });

  it('builds messages without answer key', () => {
    const { messages } = buildJudgePrompt({
      slotsWithResponses: baseMsgs,
      answerKeyTrimmed: '',
      judgeWebContext: '',
      promptText: 'What is 2+2?',
      judgeFeedback: '',
      judgeInstructions: '',
    });
    const content = messages.map((m) => m.content).join('\n');
    expect(content).not.toContain('ANSWER KEY (base');
    expect(content).toContain('own knowledge');
  });

  it('includes custom judge instructions', () => {
    const { messages } = buildJudgePrompt({
      slotsWithResponses: baseMsgs,
      answerKeyTrimmed: '',
      judgeWebContext: '',
      promptText: 'test',
      judgeFeedback: '',
      judgeInstructions: 'Weight accuracy 80%, style 20%.',
    });
    const content = messages.map((m) => m.content).join('\n');
    expect(content).toContain('Weight accuracy 80%');
  });

  it('includes judge feedback as user correction', () => {
    const { messages } = buildJudgePrompt({
      slotsWithResponses: baseMsgs,
      answerKeyTrimmed: '4',
      judgeWebContext: '',
      promptText: 'test',
      judgeFeedback: 'Actually the answer is 5',
      judgeInstructions: '',
    });
    const systemMsg = messages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('Actually the answer is 5');
  });
});

// ---------- Score history ----------
describe('score history', () => {
  it('computeTotals sums correctly', () => {
    const history = [
      { questionIndex: 0, questionText: 'Q1', scores: { B: 7, C: 5 }, timestamp: 1 },
      { questionIndex: 1, questionText: 'Q2', scores: { B: 8, C: 6, D: 9 }, timestamp: 2 },
    ];
    expect(computeTotals(history)).toEqual({ B: 15, C: 11, D: 9 });
  });

  it('computeTotals returns zeros for empty history', () => {
    expect(computeTotals([])).toEqual({ B: 0, C: 0, D: 0 });
  });

  it('addScoreRound appends correctly', () => {
    const history = [];
    const updated = addScoreRound(history, 0, 'Test Q', { B: 8, C: 6 });
    expect(updated).toHaveLength(1);
    expect(updated[0].scores).toEqual({ B: 8, C: 6 });
    expect(updated[0].questionText).toBe('Test Q');
  });
});

// ---------- migrateOldQuestionsAndAnswers ----------
describe('migrateOldQuestionsAndAnswers', () => {
  it('returns empty for empty input', () => {
    expect(migrateOldQuestionsAndAnswers('', '')).toBe('');
  });

  it('migrates questions with answers', () => {
    const result = migrateOldQuestionsAndAnswers('1. Q one\n2. Q two', '1. A one\n2. A two');
    expect(result).toContain('1. Q one');
    expect(result).toContain('Answer: A one');
    expect(result).toContain('2. Q two');
    expect(result).toContain('Answer: A two');
  });

  it('migrates questions without answers', () => {
    const result = migrateOldQuestionsAndAnswers('1. Q one\n2. Q two', '');
    expect(result).toContain('1. Q one');
    expect(result).not.toContain('Answer:');
  });
});
