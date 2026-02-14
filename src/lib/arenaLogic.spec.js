import { describe, it, expect } from 'vitest';
import {
  parseQuestionsAndAnswers,
  parseJudgeScores,
  parseJudgeScoresAndExplanations,
  parseBlindJudgeScores,
  shuffleArray,
  makeSeededRandom,
  buildJudgePromptBlind,
  stripThinkBlocks,
  detectLoop,
  contentToText,
  arenaStandingLabel,
  buildJudgePrompt,
  addScoreRound,
  computeTotals,
  migrateOldQuestionsAndAnswers,
  pickJudgeModel,
  sanitizeContestantResponse,
} from './arenaLogic.js';

// ---------- parseQuestionsAndAnswers ----------
describe('parseQuestionsAndAnswers', () => {
  // --- Edge cases ---
  it('returns empty arrays for empty input', () => {
    expect(parseQuestionsAndAnswers('')).toEqual({ questions: [], answers: [] });
    expect(parseQuestionsAndAnswers(null)).toEqual({ questions: [], answers: [] });
    expect(parseQuestionsAndAnswers(undefined)).toEqual({ questions: [], answers: [] });
    expect(parseQuestionsAndAnswers('   \n\n  ')).toEqual({ questions: [], answers: [] });
  });

  // --- Format 1: Numbered interleaved (1. Q\nAnswer: A) ---
  describe('Format: numbered interleaved', () => {
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

    it('handles mixed (some with answers, some without)', () => {
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

    it('handles Windows \\r\\n line endings', () => {
      const text = '1. What is the SI unit of current?\r\nAnswer: Ampere\r\n\r\n2. What force carries light?\r\nAnswer: Electromagnetic force';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0]).toBe('What is the SI unit of current?');
      expect(result.questions[1]).toBe('What force carries light?');
      expect(result.answers[0]).toBe('Ampere');
      expect(result.answers[1]).toBe('Electromagnetic force');
    });

    it('handles multiple blank lines between questions', () => {
      const text = '1. Q one\nAnswer: A one\n\n\n\n2. Q two\nAnswer: A two\n\n\n3. Q three';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toHaveLength(3);
      expect(result.answers[0]).toBe('A one');
      expect(result.answers[1]).toBe('A two');
    });

    it('handles trailing whitespace on blank lines', () => {
      const text = '1. Q one\nAnswer: A one\n   \n2. Q two\nAnswer: A two';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toHaveLength(2);
    });
  });

  // --- Format 2: Q/A labeled ---
  describe('Format: Q/A labeled', () => {
    it('parses Q: / A: format', () => {
      const text = 'Q: What is 2+2?\nA: 4\n\nQ: Capital of France?\nA: Paris';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['What is 2+2?', 'Capital of France?']);
      expect(result.answers).toEqual(['4', 'Paris']);
    });

    it('parses Question: / Answer: format', () => {
      const text = 'Question: What is water?\nAnswer: H2O\n\nQuestion: What is fire?\nAnswer: Combustion';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['What is water?', 'What is fire?']);
      expect(result.answers).toEqual(['H2O', 'Combustion']);
    });

    it('handles Q/A without blank lines between pairs', () => {
      const text = 'Q: First question\nA: First answer\nQ: Second question\nA: Second answer';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['First question', 'Second question']);
      expect(result.answers).toEqual(['First answer', 'Second answer']);
    });

    it('handles Q: without A: (no answers)', () => {
      const text = 'Q: First\nQ: Second\nQ: Third';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toHaveLength(3);
      expect(result.answers).toEqual(['', '', '']);
    });
  });

  // --- Format 3: Separate blocks ---
  describe('Format: separate question and answer blocks', () => {
    it('parses Questions: / Answers: sections', () => {
      const text = 'Questions:\n1. What is 2+2?\n2. Capital of France?\n\nAnswers:\n1. 4\n2. Paris';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['What is 2+2?', 'Capital of France?']);
      expect(result.answers).toEqual(['4', 'Paris']);
    });

    it('parses Answer Key: header', () => {
      const text = '1. What is water?\n2. What is fire?\n\nAnswer Key:\n1. H2O\n2. Combustion';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['What is water?', 'What is fire?']);
      expect(result.answers).toEqual(['H2O', 'Combustion']);
    });

    it('handles fewer answers than questions', () => {
      const text = 'Questions:\n1. Q one\n2. Q two\n3. Q three\n\nAnswers:\n1. A one';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toHaveLength(3);
      expect(result.answers[0]).toBe('A one');
      expect(result.answers[1]).toBe('');
      expect(result.answers[2]).toBe('');
    });
  });

  // --- Format 4: JSON ---
  describe('Format: JSON', () => {
    it('parses JSON array of {question, answer}', () => {
      const text = JSON.stringify([
        { question: 'What is 2+2?', answer: '4' },
        { question: 'Capital of France?', answer: 'Paris' },
      ]);
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['What is 2+2?', 'Capital of France?']);
      expect(result.answers).toEqual(['4', 'Paris']);
    });

    it('parses JSON array of {q, a}', () => {
      const text = JSON.stringify([
        { q: 'What is water?', a: 'H2O' },
        { q: 'What is fire?', a: 'Combustion' },
      ]);
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['What is water?', 'What is fire?']);
      expect(result.answers).toEqual(['H2O', 'Combustion']);
    });

    it('parses JSON with questions only', () => {
      const text = JSON.stringify([
        { question: 'Q1' },
        { question: 'Q2' },
      ]);
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['Q1', 'Q2']);
      expect(result.answers).toEqual(['', '']);
    });

    it('handles pretty-printed JSON', () => {
      const text = JSON.stringify([
        { question: 'Q1', answer: 'A1' },
      ], null, 2);
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['Q1']);
      expect(result.answers).toEqual(['A1']);
    });
  });

  // --- Format 5: Plain numbered (no answers) ---
  describe('Format: plain numbered list', () => {
    it('parses plain numbered list', () => {
      const text = '1. First question\n2. Second question\n3. Third question';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['First question', 'Second question', 'Third question']);
      expect(result.answers).toEqual(['', '', '']);
    });
  });

  // --- Robustness ---
  describe('Robustness', () => {
    it('handles mixed \\r\\n and \\n line endings', () => {
      const text = '1. Q one\r\nAnswer: A one\n\n2. Q two\r\nAnswer: A two';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toHaveLength(2);
      expect(result.answers).toEqual(['A one', 'A two']);
    });

    it('strips leading/trailing whitespace from questions and answers', () => {
      const text = '1.   Padded question  \nAnswer:   Padded answer  ';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions[0]).toBe('Padded question');
      expect(result.answers[0]).toBe('Padded answer');
    });

    it('handles a single question with no number', () => {
      const text = 'What is the meaning of life?';
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toEqual(['What is the meaning of life?']);
      expect(result.answers).toEqual(['']);
    });

    it('handles real-world messy paste (user scenario)', () => {
      const text = `1. What is the SI unit of electric current?
Answer: Ampere

2. What fundamental force is responsible for holding atomic nuclei together?
Answer: Strong nuclear force

3. In thermodynamics, what is the name of the quantity that measures disorder?
Answer: Entropy`;
      const result = parseQuestionsAndAnswers(text);
      expect(result.questions).toHaveLength(3);
      expect(result.questions[0]).toBe('What is the SI unit of electric current?');
      expect(result.questions[2]).toBe('In thermodynamics, what is the name of the quantity that measures disorder?');
      expect(result.answers[0]).toBe('Ampere');
      expect(result.answers[1]).toBe('Strong nuclear force');
      expect(result.answers[2]).toBe('Entropy');
    });
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

  it('parses Model A scores (all slots A–D are scored)', () => {
    const text = 'Model A: 10/10 - judge\nModel B: 7/10 - ok';
    expect(parseJudgeScores(text)).toEqual({ A: 10, B: 7 });
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

// ---------- parseJudgeScoresAndExplanations ----------
describe('parseJudgeScoresAndExplanations', () => {
  it('returns scores and per-model explanation text', () => {
    const text = 'Model A: 7/10 - Correct approach.\nModel B: 5/10 - Partial.\nModel C: 9/10 - Excellent.';
    const { scores, explanations } = parseJudgeScoresAndExplanations(text);
    expect(scores).toEqual({ A: 7, B: 5, C: 9 });
    expect(explanations.A).toContain('Correct approach');
    expect(explanations.B).toContain('Partial');
    expect(explanations.C).toContain('Excellent');
  });

  it('returns empty for empty input', () => {
    expect(parseJudgeScoresAndExplanations('')).toEqual({ scores: {}, explanations: {} });
    expect(parseJudgeScoresAndExplanations(null)).toEqual({ scores: {}, explanations: {} });
  });
});

// ---------- sanitizeContestantResponse ----------
describe('sanitizeContestantResponse', () => {
  it('strips "Model X: N/10" lines from contestant output', () => {
    const text = 'Manacher algorithm runs in O(n).\n\nModel B: 7/10 - reason\n\nActually it is linear.';
    const cleaned = sanitizeContestantResponse(text);
    expect(cleaned).not.toContain('Model B: 7/10');
    expect(cleaned).toContain('Manacher algorithm');
    expect(cleaned).toContain('Actually it is linear');
  });

  it('strips "Response N: N/10" lines', () => {
    const text = 'Good answer.\nResponse 1: 8/10 - correct\nDone.';
    expect(sanitizeContestantResponse(text)).not.toContain('Response 1: 8/10');
    expect(sanitizeContestantResponse(text)).toContain('Good answer');
  });

  it('strips <think> blocks', () => {
    const text = '<think>internal reasoning</think>The answer is 42.';
    expect(sanitizeContestantResponse(text)).toBe('The answer is 42.');
  });

  it('handles empty/null input', () => {
    expect(sanitizeContestantResponse('')).toBe('');
    expect(sanitizeContestantResponse(null)).toBe('');
  });

  it('preserves clean responses unchanged', () => {
    const text = 'The longest palindromic substring can be found using Manacher\'s algorithm.\n\nFinal Answer: Manacher\'s algorithm';
    expect(sanitizeContestantResponse(text)).toBe(text);
  });
});

// ---------- makeSeededRandom ----------
describe('makeSeededRandom', () => {
  it('returns a function that produces numbers in [0, 1)', () => {
    const rng = makeSeededRandom('seed1');
    for (let i = 0; i < 10; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('same seed produces same sequence', () => {
    const a = makeSeededRandom('abc');
    const b = makeSeededRandom('abc');
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it('different seeds produce different sequences', () => {
    expect(makeSeededRandom('a')()).not.toBe(makeSeededRandom('b')());
  });
});

// ---------- shuffleArray ----------
describe('shuffleArray', () => {
  it('returns new array of same length', () => {
    const arr = [1, 2, 3];
    const out = shuffleArray(arr);
    expect(out).toHaveLength(3);
    expect(arr).toEqual([1, 2, 3]);
  });

  it('with seeded random produces deterministic order', () => {
    const arr = ['A', 'B', 'C'];
    const out1 = shuffleArray(arr, makeSeededRandom('run-1'));
    const out2 = shuffleArray(arr, makeSeededRandom('run-1'));
    expect(out1).toEqual(out2);
    expect(out1.sort()).toEqual(['A', 'B', 'C']);
  });
});

// ---------- parseBlindJudgeScores ----------
describe('parseBlindJudgeScores', () => {
  it('maps Response N to slot via responseOrder', () => {
    const text = 'Response 1: 7/10 - Good.\nResponse 2: 5/10 - Partial.\nResponse 3: 9/10 - Excellent.';
    const responseOrder = ['B', 'A', 'C'];
    const { scores, explanations } = parseBlindJudgeScores(text, responseOrder);
    expect(scores).toEqual({ B: 7, A: 5, C: 9 });
    expect(explanations.B).toContain('Good');
    expect(explanations.A).toContain('Partial');
    expect(explanations.C).toContain('Excellent');
  });

  it('returns empty for empty text or missing responseOrder', () => {
    expect(parseBlindJudgeScores('', ['A', 'B'])).toEqual({ scores: {}, explanations: {} });
    expect(parseBlindJudgeScores('Response 1: 5/10', null)).toEqual({ scores: {}, explanations: {} });
  });
});

// ---------- buildJudgePromptBlind ----------
describe('buildJudgePromptBlind', () => {
  it('returns messages and responseOrder', () => {
    const slotsWithResponses = [
      { slot: 'A', msgs: [{ role: 'assistant', content: 'Answer A' }] },
      { slot: 'B', msgs: [{ role: 'assistant', content: 'Answer B' }] },
    ];
    const { messages, responseOrder } = buildJudgePromptBlind({
      slotsWithResponses,
      answerKeyTrimmed: '',
      judgeWebContext: '',
      promptText: 'Q?',
      judgeFeedback: '',
      shuffleRandom: () => 0,
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(responseOrder).toHaveLength(2);
    expect(responseOrder).toContain('A');
    expect(responseOrder).toContain('B');
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
  it('computeTotals sums correctly (all slots A–D)', () => {
    const history = [
      { questionIndex: 0, questionText: 'Q1', scores: { B: 7, C: 5 }, timestamp: 1 },
      { questionIndex: 1, questionText: 'Q2', scores: { B: 8, C: 6, D: 9 }, timestamp: 2 },
    ];
    expect(computeTotals(history)).toEqual({ A: 0, B: 15, C: 11, D: 9 });
  });

  it('computeTotals returns zeros for empty history', () => {
    expect(computeTotals([])).toEqual({ A: 0, B: 0, C: 0, D: 0 });
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

// ---------- pickJudgeModel ----------
describe('pickJudgeModel', () => {
  const allModels = [
    { id: 'qwen3-vl-4b-instruct' },
    { id: 'essentialai/rny-1' },
    { id: 'meta-llama-3.1-8b-instruct' },
    { id: 'zai-org/glm-4.6v-flash' },
    { id: 'qwen3-32b-instruct' },
  ];

  it('picks largest non-contestant when no user choice', () => {
    const result = pickJudgeModel({
      userChoice: '',
      contestantIds: ['qwen3-vl-4b-instruct', 'essentialai/rny-1', 'meta-llama-3.1-8b-instruct', 'zai-org/glm-4.6v-flash'],
      availableModels: allModels,
    });
    expect(result.id).toBe('qwen3-32b-instruct');
    expect(result.fallback).toBe(true);
  });

  it('uses explicit user choice if not a contestant', () => {
    const result = pickJudgeModel({
      userChoice: 'qwen3-32b-instruct',
      contestantIds: ['qwen3-vl-4b-instruct', 'essentialai/rny-1'],
      availableModels: allModels,
    });
    expect(result.id).toBe('qwen3-32b-instruct');
    expect(result.fallback).toBeUndefined();
  });

  it('rejects user choice if it IS a contestant and falls back', () => {
    const result = pickJudgeModel({
      userChoice: 'qwen3-vl-4b-instruct',
      contestantIds: ['qwen3-vl-4b-instruct', 'essentialai/rny-1'],
      availableModels: allModels,
    });
    expect(result.id).not.toBe('qwen3-vl-4b-instruct');
    expect(result.id).toBeTruthy();
    expect(result.fallback).toBe(true);
  });

  it('returns error if all models are contestants', () => {
    const result = pickJudgeModel({
      userChoice: '',
      contestantIds: allModels.map((m) => m.id),
      availableModels: allModels,
    });
    expect(result.id).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('prefers instruct over base model of same size', () => {
    const result = pickJudgeModel({
      userChoice: '',
      contestantIds: [],
      availableModels: [
        { id: 'llama-3.1-8b' },
        { id: 'llama-3.1-8b-instruct' },
      ],
    });
    expect(result.id).toBe('llama-3.1-8b-instruct');
  });
});
