/**
 * @file arenaLogic.js
 * @description Pure logic for Arena: Q&A parsing, judge score parsing, loop detection,
 * score history tracking, system prompt templates, and judge prompt building.
 * Extracted from DashboardArena.svelte for testability and reuse.
 */

// ---------- System prompt templates ----------

/**
 * Hardcoded system prompt for Arena contestants.
 * CRITICAL: Must NEVER mention judges, scoring, competition, other models, or evaluation.
 * Cached/persisted system prompts are IGNORED for contestants — only this is used.
 */
export const ARENA_CONTESTANT_SYSTEM_PROMPT =
  'Answer the question directly and concisely. Follow any instructions or constraints given. Do not discuss how you would be evaluated. End your response with "Final Answer: " followed by your concise answer.';

export const ARENA_SYSTEM_PROMPT_TEMPLATES = [
  { name: '—', prompt: '' },
  { name: 'General', prompt: 'You are a helpful assistant.' },
  { name: 'Code', prompt: 'You are an expert programmer. Be concise. Prefer code over prose when relevant.' },
  { name: 'Research', prompt: 'You are a thorough researcher. Cite sources when possible. Structure answers with clear sections.' },
  { name: 'Creative', prompt: 'You are a creative writer. Use vivid language and varied structure. Be engaging and original.' },
  {
    name: 'Arena contestant',
    prompt: 'Answer the question directly and concisely. Follow any instructions or constraints given. Do not discuss how you would be evaluated. End your response with "Final Answer: " followed by your concise answer.',
  },
  {
    name: 'Arena judge',
    prompt: 'You are the judge in an AI model competition. You will receive the question, an optional answer key, and each competing model\'s response. Score each response 1–10 (10 = best) with one short reason, based on accuracy and adherence to the answer key (or your own knowledge if no key is provided). Your reply must contain only the score lines (e.g. Model B: 7/10 - reason). No preamble, no <think>, no lengthy analysis—just the scores.',
  },
];

// ---------- Q&A parser ----------

/**
 * Parse "Questions & answers" text into { questions, answers }.
 * Auto-detects format:
 *   1. JSON array of objects with question/q and answer/a keys
 *   2. Separate blocks: "Questions:" header then "Answers:" / "Answer Key:" header
 *   3. Q:/A: or Question:/Answer: labeled pairs
 *   4. Numbered interleaved: "1. Question\nAnswer: answer\n\n2. ..."
 *   5. Plain numbered list (no answers)
 *   6. Single un-numbered question as fallback
 *
 * Handles \r\n, multiple blank lines, trailing whitespace, and mixed formats robustly.
 * @param {string} text
 * @returns {{ questions: string[], answers: string[] }}
 */
export function parseQuestionsAndAnswers(text) {
  if (!text || typeof text !== 'string') return { questions: [], answers: [] };
  // Normalize line endings to \n and trim
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return { questions: [], answers: [] };

  // --- Format 1: JSON ---
  if (/^\s*\[/.test(normalized)) {
    try {
      const arr = JSON.parse(normalized);
      if (Array.isArray(arr) && arr.length > 0) {
        const result = tryParseJSON(arr);
        if (result) return result;
      }
    } catch (_) { /* not valid JSON, fall through */ }
  }

  // --- Format 2: Separate blocks (Questions: ... Answers: ...) ---
  const separateResult = tryParseSeparateBlocks(normalized);
  if (separateResult) return separateResult;

  // --- Format 3: Numbered interleaved (with optional Answer: per block) ---
  // Check numbered BEFORE Q/A labeled because "Question:" prefix + "Answer:" can
  // look like Q/A labeled, but numbered format takes priority when numbers are present.
  const numberedResult = tryParseNumbered(normalized);
  if (numberedResult) return numberedResult;

  // --- Format 4: Markdown list (- or *) ---
  const mdListResult = tryParseMarkdownList(normalized);
  if (mdListResult) return mdListResult;

  // --- Format 5: Q:/A: or Question:/Answer: labeled ---
  const qaResult = tryParseQALabeled(normalized);
  if (qaResult) return qaResult;

  // --- Format 6: Separated blocks (double newline) fallback ---
  const blockResult = tryParseBlocks(normalized);
  if (blockResult) return blockResult;

  // --- Fallback: treat entire text as a single question ---
  const trimmed = normalized.trim();
  if (trimmed) return { questions: [trimmed], answers: [''] };
  return { questions: [], answers: [] };
}

/** Try to parse JSON array of Q&A objects. */
function tryParseJSON(arr) {
  const questions = [];
  const answers = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const q = (item.question ?? item.q ?? item.Q ?? item.Question ?? '').toString().trim();
    const a = (item.answer ?? item.a ?? item.A ?? item.Answer ?? '').toString().trim();
    if (q) {
      questions.push(q);
      answers.push(a);
    }
  }
  return questions.length > 0 ? { questions, answers } : null;
}

/**
 * Try to parse separate "Questions:" and "Answers:" blocks.
 * Detects headers like "Questions:", "Answers:" (PLURAL), "Answer Key:" (two words).
 * Does NOT match singular "Answer:" which is interleaved format.
 */
function tryParseSeparateBlocks(text) {
  // Only match plural "Answers:" or "Answer Key:" — NOT singular "Answer:" (that's interleaved)
  const answerHeaderRe = /^(?:answers|answer\s+key)\s*:/im;
  const answerHeaderMatch = text.match(answerHeaderRe);
  if (!answerHeaderMatch) return null;

  const headerIndex = text.indexOf(answerHeaderMatch[0]);
  let questionSection = text.slice(0, headerIndex).trim();
  const answerSection = text.slice(headerIndex + answerHeaderMatch[0].length).trim();

  // Strip "Questions:" header from the question section if present
  questionSection = questionSection.replace(/^(?:questions?)\s*:\s*/i, '').trim();

  const questions = extractNumberedItems(questionSection);
  const answersRaw = extractNumberedItems(answerSection);
  if (questions.length === 0) return null;

  // Pad answers to match questions length
  const answers = questions.map((_, i) => (answersRaw[i] ?? '').trim());
  return { questions, answers };
}

/**
 * Try to parse Q:/A: or Question:/Answer: labeled format.
 * Each Q starts a new question; A (if present) provides the answer.
 */
function tryParseQALabeled(text) {
  // Check if the text has Q: or Question: patterns
  const lines = text.split('\n');
  const qPattern = /^\s*(?:Q|Question)\s*:\s*(.*)/i;
  const aPattern = /^\s*(?:A|Answer)\s*:\s*(.*)/i;

  // Need at least 2 Q: lines to confirm this format (or 1 Q: + 1 A:)
  let qCount = 0;
  let aCount = 0;
  for (const line of lines) {
    if (qPattern.test(line)) qCount++;
    if (aPattern.test(line)) aCount++;
  }
  if (qCount < 1 || (qCount < 2 && aCount < 1)) return null;

  const questions = [];
  const answers = [];
  let currentQ = null;
  let currentA = null;

  function flush() {
    if (currentQ !== null) {
      questions.push(currentQ.trim());
      answers.push((currentA ?? '').trim());
    }
    currentQ = null;
    currentA = null;
  }

  for (const line of lines) {
    const qMatch = line.match(qPattern);
    const aMatch = line.match(aPattern);
    if (qMatch) {
      flush();
      currentQ = qMatch[1].trim();
    } else if (aMatch && currentQ !== null) {
      currentA = aMatch[1].trim();
    } else if (currentA !== null) {
      // Continuation of multi-line answer
      currentA += '\n' + line;
    } else if (currentQ !== null && !aMatch) {
      // Continuation of multi-line question (before any A:)
      currentQ += '\n' + line;
    }
  }
  flush();

  return questions.length > 0 ? { questions, answers } : null;
}

/**
 * Try to parse numbered format: "1. Question\nAnswer: answer\n\n2. ..."
 * Handles 1. or 1) numbering, optional Answer: lines, multiple blank lines.
 */
function tryParseNumbered(text) {
  // Split into blocks at lines starting with a number prefix
  const blocks = text.split(/\n\s*(?=\d+[.)]\s+)/).filter((b) => b.trim().length > 0);
  if (blocks.length === 0) return null;

  // Check that at least the first block starts with a number
  if (!/^\s*\d+[.)]\s+/.test(blocks[0])) return null;

  return parseBlocksToQA(blocks, /^\s*\d+[.)]\s+/);
}

/**
 * Try to parse markdown list format: "- Question" or "* Question".
 */
function tryParseMarkdownList(text) {
  // Split into blocks at lines starting with a bullet
  const blocks = text.split(/\n\s*(?=[-]\s+)/).filter((b) => b.trim().length > 0);
  if (blocks.length === 0) return null; // No bullets found or split failed

  // Check that at least the first block starts with a bullet
  // Using simplified check: strictly look for lines starting with "- " or "* "
  if (!/^\s*[-]\s+/.test(blocks[0])) {
    // try * bullets
    const blocksStar = text.split(/\n\s*(?=[*]\s+)/).filter((b) => b.trim().length > 0);
    if (blocksStar.length > 0 && /^\s*[*]\s+/.test(blocksStar[0])) {
      return parseBlocksToQA(blocksStar, /^\s*[*]\s+/);
    }
    return null;
  }

  return parseBlocksToQA(blocks, /^\s*[-]\s+/);
}

/**
 * Try to parse plain text blocks separated by double newlines.
 * e.g. "Question 1\n\nQuestion 2\nAnswer: Something"
 */
function tryParseBlocks(text) {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  if (blocks.length < 2) return null; // If only 1 block, let fallback handle it as single question

  return parseBlocksToQA(blocks, null);
}

/**
 * Helper to process a list of raw text blocks into Q/A pairs.
 * Each block is treated as one item.
 * @param {string[]} blocks
 * @param {RegExp|null} stripPrefixRegex - regex to strip from start of question line (e.g. numbering)
 */
function parseBlocksToQA(blocks, stripPrefixRegex) {
  const questions = [];
  const answers = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let first = lines[0] || '';
    if (stripPrefixRegex) {
      first = first.replace(stripPrefixRegex, '').trim();
    } else {
      first = first.trim();
    }

    let questionLines = [];
    let answerLines = [];
    let inAnswer = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check for explicit "Answer:" label
      if (/^\s*(?:Answer|A)\s*:\s*/i.test(line)) {
        inAnswer = true;
        answerLines.push(line.replace(/^\s*(?:Answer|A)\s*:\s*/i, '').trim());
      } else if (inAnswer) {
        answerLines.push(line);
      } else {
        questionLines.push(i === 0 ? first : line);
      }
    }
    const q = questionLines.join('\n').trim();
    const a = answerLines.join('\n').trim();
    if (q.length > 0) {
      questions.push(q);
      answers.push(a);
    }
  }
  return questions.length > 0 ? { questions, answers } : null;
}

/**
 * Extract numbered items from a section of text.
 * Handles "1. item", "1) item", or plain lines.
 */
function extractNumberedItems(text) {
  if (!text || !text.trim()) return [];
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  // Check if lines are numbered
  const numberedLines = lines.filter((l) => /^\s*\d+[.)]\s+/.test(l));
  if (numberedLines.length > 0) {
    return numberedLines.map((l) => l.replace(/^\s*\d+[.)]\s+/, '').trim());
  }
  // Fallback: each non-empty line is an item
  return lines.map((l) => l.trim());
}

/**
 * Migrate old separate question list + answer key into combined format.
 * @param {string} oldQuestions
 * @param {string} oldAnswers
 * @returns {string} Combined format
 */
export function migrateOldQuestionsAndAnswers(oldQuestions, oldAnswers) {
  if (!oldQuestions || oldQuestions.trim() === '') return '';
  const qLines = oldQuestions.split(/\n/).filter((s) => s.trim().length > 0);
  const aLines = (oldAnswers || '').split(/\n/).filter((s) => s.trim().length > 0);
  return qLines
    .map((line, i) => {
      const num = i + 1;
      const q = line.replace(/^\s*\d+[.)]\s*/, '').trim();
      const a = aLines[i] != null ? aLines[i].replace(/^\s*\d+[.)]\s*/, '').trim() : '';
      return a ? `${num}. ${q}\nAnswer: ${a}` : `${num}. ${q}`;
    })
    .join('\n\n');
}

// ---------- Judge score parser ----------

/**
 * Strip <think>...</think> blocks from text (some models emit them despite instructions).
 * @param {string} text
 * @returns {string}
 */
export function stripThinkBlocks(text) {
  if (!text || typeof text !== 'string') return text || '';
  // Remove <think>...</think> blocks (greedy, handles multi-line)
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Strip judge-pattern lines from a contestant response.
 * Some models hallucinate "Model B: 7/10 - reason" or similar scoring patterns.
 * Also strips <think>...</think> blocks.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeContestantResponse(text) {
  if (!text || typeof text !== 'string') return text || '';
  let cleaned = stripThinkBlocks(text);
  // Remove lines that look like judge scoring: "Model X: N/10" or "Response N: N/10"
  cleaned = cleaned.replace(/^.*(?:Model\s+[A-D]|Response\s+\d+)\s*:\s*\d+\s*\/\s*10.*$/gim, '');
  // Collapse multiple blank lines into one
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

/**
 * Parse judge output for "Model A: 7/10" lines; return { A: 7, B: 5, ... }.
 * Strips <think> blocks before parsing (some models emit them despite instructions).
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function parseJudgeScores(text) {
  if (!text || typeof text !== 'string') return {};
  const cleaned = stripThinkBlocks(text);
  const out = {};
  const re = /Model\s+([A-D]):\s*(\d+)\s*\/\s*10/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const slot = m[1].toUpperCase();
    const n = parseInt(m[2], 10);
    if (slot >= 'A' && slot <= 'D' && n >= 0 && n <= 10) out[slot] = n;
  }
  return out;
}

/**
 * Parse judge output into scores and per-model explanation text.
 * Expects lines like "Model A: 7/10 - one short sentence".
 * @param {string} text
 * @returns {{ scores: Record<string, number>, explanations: Record<string, string> }}
 */
export function parseJudgeScoresAndExplanations(text) {
  if (!text || typeof text !== 'string') return { scores: {}, explanations: {} };
  const cleaned = stripThinkBlocks(text);
  const scores = {};
  const explanations = {};
  const re = /Model\s+([A-D]):\s*(\d+)\s*\/\s*10\s*(?:-\s*)?([\s\S]*?)(?=Model\s+[A-D]:|$)/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const slot = m[1].toUpperCase();
    const n = parseInt(m[2], 10);
    const reason = (m[3] || '').trim();
    if (slot >= 'A' && slot <= 'D' && n >= 0 && n <= 10) {
      scores[slot] = n;
      explanations[slot] = reason;
    }
  }
  return { scores, explanations };
}

// ---------- Loop detection ----------

/**
 * Detect repeating tail (runaway loop) and return true if the last 80 chars repeat 2+ times.
 * @param {string} content
 * @returns {boolean}
 */
export function detectLoop(content) {
  if (content.length < 200) return false;
  const tailLen = 80;
  const tail = content.slice(-tailLen);
  const beforeTail = content.slice(0, -tailLen);
  if (beforeTail.length < tailLen * 2) return false;
  const count = (beforeTail.match(new RegExp(tail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  return count >= 2;
}

// ---------- Score history ----------

/**
 * A single round's scores for one question.
 * @typedef {{ questionIndex: number, questionText: string, scores: Record<string, number>, timestamp: number }} ScoreRound
 */

/**
 * Load score history from localStorage.
 * @returns {ScoreRound[]}
 */
export function loadScoreHistory() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem('arenaScoreHistory');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Save score history to localStorage.
 * @param {ScoreRound[]} history
 */
export function saveScoreHistory(history) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('arenaScoreHistory', JSON.stringify(history));
}

/**
 * Add a round to score history.
 * @param {ScoreRound[]} history - current history
 * @param {number} questionIndex
 * @param {string} questionText
 * @param {Record<string, number>} scores - e.g. { B: 7, C: 5 }
 * @returns {ScoreRound[]} updated history
 */
export function addScoreRound(history, questionIndex, questionText, scores) {
  const round = { questionIndex, questionText, scores: { ...scores }, timestamp: Date.now() };
  const next = [...history, round];
  saveScoreHistory(next);
  return next;
}

/**
 * Compute running totals from history.
 * @param {ScoreRound[]} history
 * @returns {{ A: number, B: number, C: number, D: number }}
 */
export function computeTotals(history) {
  const totals = { A: 0, B: 0, C: 0, D: 0 };
  for (const round of history) {
    for (const [slot, score] of Object.entries(round.scores)) {
      if (slot in totals) totals[slot] += score;
    }
  }
  return totals;
}

/**
 * Clear score history from localStorage.
 */
export function clearScoreHistory() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem('arenaScoreHistory');
}

// ---------- Content helpers ----------

/**
 * Extract text from message content (string or multi-part array).
 * @param {string | Array<{ type: string, text?: string }>} content
 * @returns {string}
 */
export function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p?.type === 'text' ? p.text : '')).filter(Boolean).join('\n');
  }
  return '';
}

// ---------- Blind review (shuffle + anonymize) ----------

/**
 * Create a seeded RNG for reproducible shuffle. Uses a simple hash of the seed string.
 * @param {string} seed - e.g. run UUID
 * @returns {() => number} - returns value in [0, 1)
 */
export function makeSeededRandom(seed) {
  let h = 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  h = h >>> 0;
  return function next() {
    h = (Math.imul(1664525, h) + 1013904223) | 0;
    return (h >>> 0) / (0xffffffff + 1);
  };
}

/**
 * Fisher–Yates shuffle; returns new array so original is unchanged.
 * @param {Array<T>} arr
 * @param {() => number} [random] - default Math.random; use makeSeededRandom(seed) for reproducibility
 * @returns {Array<T>}
 */
export function shuffleArray(arr, random = Math.random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Parse blind judge output: "Response 1: 7/10 - reason" etc.
 * @param {string} text
 * @param {string[]} responseOrder - responseOrder[i] is the slot for "Response i+1"
 * @returns {{ scores: Record<string, number>, explanations: Record<string, string> }}
 */
export function parseBlindJudgeScores(text, responseOrder) {
  if (!text || typeof text !== 'string' || !Array.isArray(responseOrder)) return { scores: {}, explanations: {} };
  const cleaned = stripThinkBlocks(text);
  const scores = {};
  const explanations = {};
  const re = /Response\s+(\d+):\s*(\d+)\s*\/\s*10\s*(?:-\s*)?([\s\S]*?)(?=Response\s+\d+:|\s*$)/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const oneBased = parseInt(m[1], 10);
    const n = parseInt(m[2], 10);
    const reason = (m[3] || '').trim();
    const slot = responseOrder[oneBased - 1];
    if (slot && n >= 0 && n <= 10) {
      scores[slot] = n;
      explanations[slot] = reason;
    }
  }
  return { scores, explanations };
}

// ---------- Judge prompt builder ----------

/**
 * Build the judge prompt for scoring.
 * @param {Object} opts
 * @param {Array<{ slot: string, msgs: Array }>} opts.slotsWithResponses
 * @param {string} opts.answerKeyTrimmed - answer for current question ('' if none)
 * @param {string} opts.judgeWebContext - web search context ('' if none)
 * @param {string} opts.promptText - original question text
 * @param {string} opts.judgeFeedback - optional user correction
 * @param {string} [opts.judgeInstructions] - optional custom judge instructions
 * @returns {{ messages: Array<{ role: string, content: string }> }}
 */
export function buildJudgePrompt({ slotsWithResponses, answerKeyTrimmed, judgeWebContext, promptText, judgeFeedback, judgeInstructions }) {
  const competingSlots = slotsWithResponses.map((s) => s.slot);
  const competingList = competingSlots.join(', ');
  const firstSlot = competingSlots[0] || 'A';
  const feedback = typeof judgeFeedback === 'string' ? judgeFeedback.trim() : '';
  const customInstr = typeof judgeInstructions === 'string' ? judgeInstructions.trim() : '';

  const parts = [
    customInstr || 'You are a judge. Score each model response 1-10 (10 = best) with one short reason.',
    '',
    `COMPETING MODELS (authoritative—do not guess): This round has exactly ${competingSlots.length} model(s): ${competingList}. You must output exactly one line for each of these, in this order: ${competingList}. Do not add or mention Model E or any other model. Only ${competingList}. If a model has no response below, write: Model X: 0/10 - No response.`,
    '',
    answerKeyTrimmed
      ? 'BASIS FOR SCORING: An ANSWER KEY is provided below. Judge whether each model\'s response is SUBSTANTIVELY CORRECT—meaning the factual content matches the answer key. IMPORTANT: If a model\'s response contains a line starting with "Final Answer:", use THAT line as the model\'s answer—ignore any verbose reasoning above it. If there is no "Final Answer:" line, evaluate the full response.\n\nSCORING EQUIVALENCES — all of these are the SAME correct answer and must receive the SAME high score:\n- "3" and "x=3" and "x = 3" (bare value = variable assignment when context is obvious)\n- "ampere" and "Ampere" and "AMPERE" (capitalization never matters)\n- "Electromagnetic force" and "electromagnetic force" and "EM force" (phrasing/abbreviation)\n- "H2O" and "water" (common synonyms)\nDo NOT penalize for omitting the variable name, extra explanation, or different phrasing. The ONLY question is: did the model give the right factual answer? A correct answer = 8-10. A partially correct answer = 4-7. A wrong answer = 1-3. No response = 0.'
      : 'BASIS FOR SCORING: No answer key was provided. Use the WEB SEARCH section below (if present) to fact-check, or use your own knowledge to evaluate correctness. IMPORTANT: If a model\'s response contains a line starting with "Final Answer:", use THAT line as the model\'s answer—ignore any verbose reasoning above it. Focus on factual accuracy. Do NOT penalize for formatting, capitalization, phrasing, or omitting variable names (e.g. "3" and "x=3" are the same answer).',
    '',
    `CRITICAL OUTPUT FORMAT: Do NOT output <think> tags, chain-of-thought, reasoning, or any analysis. Do NOT write paragraphs. Your ENTIRE reply must be ONLY the score lines—nothing before them, nothing after. Start your very first character with "Model ${firstSlot}:". Any text before the first "Model" line is a format violation.`,
    '',
    `Output exactly these lines, in this order (${competingSlots.length} line(s)):`,
    ...competingSlots.map((slot) => `Model ${slot}: X/10 - one short sentence why right or wrong`),
    'If a model has no response in the sections below: Model X: 0/10 - No response.',
    '',
  ];
  if (answerKeyTrimmed) {
    parts.push('--- ANSWER KEY (base your scoring on this) ---', answerKeyTrimmed, '');
  }
  if (judgeWebContext) {
    parts.push('--- WEB SEARCH (use to fact-check when no answer key, or to supplement) ---', judgeWebContext, '');
  }
  parts.push('--- ORIGINAL PROMPT ---', promptText || '(none)', '');
  for (const { slot, msgs } of slotsWithResponses) {
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
    const text = lastAssistant ? contentToText(lastAssistant.content) : '';
    parts.push(`--- MODEL ${slot} ---`, text.trim() || '(no response)', '');
  }
  const userContent = parts.join('\n');

  const systemWithAnswerKey = answerKeyTrimmed
    ? `You are a judge. An answer key is provided. A response is CORRECT if it gives the same factual answer as the key. Equivalences: "3" = "x=3" = "x = 3" (bare value is fine). "ampere" = "Ampere". Formatting and phrasing do NOT matter—only factual correctness. Score exactly ${competingSlots.length} model(s): ${competingList}. Output exactly one line for each, in that order. No other models. No <think>, no chain-of-thought, no analysis, no "Reasoning:" section. Start with "Model ${firstSlot}:".`
    : null;

  const messages = feedback
    ? [
      {
        role: 'system',
        content: systemWithAnswerKey
          ? `${systemWithAnswerKey}\n\nUser correction to apply when scoring:\n${feedback}`
          : `You are a judge. Use the user correction below when scoring. Your reply must be ONLY the score lines (Model B: X/10 - comment, etc.). No reasoning, no <think>, no other text.\n\nUser correction:\n${feedback}`,
      },
      { role: 'user', content: userContent },
    ]
    : systemWithAnswerKey
      ? [{ role: 'system', content: systemWithAnswerKey }, { role: 'user', content: userContent }]
      : [{ role: 'user', content: userContent }];

  return { messages };
}

/** Judge criteria per Sequential Model Arena spec. */
const JUDGE_CRITERIA_SPEC = [
  'correctness_against_answer_key',
  'logical_validity',
  'constraint_compliance',
  'clarity',
  'completeness',
];

/**
 * Build judge prompt for blind review: responses are anonymized as "Response 1", "Response 2", ...
 * and presented in shuffled order. Judge must output "Response N: X/10 - reason".
 * @param {Object} opts - same as buildJudgePrompt, plus shuffleRandom optional
 * @returns {{ messages: Array<{ role: string, content: string }>, responseOrder: string[] }}
 */
export function buildJudgePromptBlind({
  slotsWithResponses,
  answerKeyTrimmed,
  judgeWebContext,
  promptText,
  judgeFeedback,
  judgeInstructions,
  shuffleRandom = Math.random,
}) {
  const shuffled = shuffleArray(slotsWithResponses, shuffleRandom);
  const responseOrder = shuffled.map((s) => s.slot);
  const n = responseOrder.length;
  const feedback = typeof judgeFeedback === 'string' ? judgeFeedback.trim() : '';
  const customInstr = typeof judgeInstructions === 'string' ? judgeInstructions.trim() : '';

  const criteriaLine = JUDGE_CRITERIA_SPEC.join(', ');
  const parts = [
    customInstr ||
      `You are a judge. Score each response 0-10 (10 = best) with one short reason. Consider: ${criteriaLine}. Do NOT identify or guess which model wrote which response.`,
    '',
    `There are exactly ${n} responses, labeled Response 1 through Response ${n}. You must output exactly one line per response, in order. Format: "Response 1: X/10 - one short reason." then "Response 2: X/10 - ..." and so on. If a response is missing or empty, write: Response N: 0/10 - No response.`,
    '',
    answerKeyTrimmed
      ? `BASIS FOR SCORING: An ANSWER KEY is provided. Judge correctness against it. If a response contains a line "Final Answer:", use that line as the answer. Equivalences: "3" = "x=3", "ampere" = "Ampere". Correct = 8-10, partial = 4-7, wrong = 1-3, no response = 0.`
      : 'BASIS FOR SCORING: Use the web search section (if present) or your knowledge. Focus on factual accuracy. Score 0-10 with a brief reason.',
    '',
    'CRITICAL: Your ENTIRE reply must be ONLY the score lines. No <think>, no preamble, no analysis. Start with "Response 1:".',
    '',
  ];
  if (answerKeyTrimmed) {
    parts.push('--- ANSWER KEY ---', answerKeyTrimmed, '');
  }
  if (judgeWebContext) {
    parts.push('--- WEB SEARCH ---', judgeWebContext, '');
  }
  parts.push('--- ORIGINAL PROMPT ---', promptText || '(none)', '');
  shuffled.forEach(({ msgs }, i) => {
    const lastAssistantMsg = [...msgs].reverse().find((m) => m.role === 'assistant');
    const text = lastAssistantMsg ? contentToText(lastAssistantMsg.content) : '';
    parts.push(`--- Response ${i + 1} ---`, text.trim() || '(no response)', '');
  });
  const userContent = parts.join('\n');

  const systemContent = answerKeyTrimmed
    ? `You are a judge. Score each response 0-10 against the answer key. Consider: ${criteriaLine}. Output ONLY "Response 1: X/10 - reason" through "Response ${n}: X/10 - reason". No other text.`
    : `You are a judge. Score each response 0-10. Consider: ${criteriaLine}. Output ONLY the Response 1..${n} score lines. No other text.`;

  const messages = feedback
    ? [
        { role: 'system', content: `${systemContent}\n\nUser correction:\n${feedback}` },
        { role: 'user', content: userContent },
      ]
    : [{ role: 'system', content: systemContent }, { role: 'user', content: userContent }];

  return { messages, responseOrder };
}

// ---------- Witty judge loading messages ----------

export const JUDGE_LOADING_LINES = [
  { main: 'The judge is entering the courtroom.', sub: '(All rise.)' },
  { main: 'Summoning the judge…', sub: '(They were napping. Give them a second.)' },
  { main: 'Loading the judge model…', sub: '(No pressure. Only everyone\'s fate hangs in the balance.)' },
  { main: 'The judge is warming up.', sub: '(Stretching neurons. Cracking knuckles.)' },
  { main: 'Judge is being loaded…', sub: '(They take their time. It\'s a power move.)' },
  { main: 'Calling in the expert.', sub: '(They charge by the token, so let\'s be quick.)' },
  { main: 'Loading the arbiter of truth.', sub: '(Dramatic entrance in 3… 2… 1…)' },
  { main: 'Judge incoming.', sub: '(Hope the contestants studied.)' },
  { main: 'The judge approaches the bench.', sub: '(They\'ve seen things. Terrible answers. This time will be different. Maybe.)' },
  { main: 'Waking the judge…', sub: '(It\'s not easy being the smartest model in the room.)' },
];

// ---------- Witty judge web messages ----------

export const JUDGE_WEB_LINES = [
  { main: 'Judge is checking the web…', sub: '(Googling so the judge can fact-check. No, really.)' },
  { main: 'Judge is checking the internet.', sub: '(Yes, the whole thing. We asked nicely.)' },
  { main: 'Judge is consulting the oracle.', sub: '(It\'s Google. But "oracle" sounds cooler.)' },
  { main: 'Judge is fact-checking in the cloud.', sub: '(Someone had to. It\'s not gonna check itself.)' },
  { main: 'Judge is asking the internet.', sub: '(We\'ll see if it answers. Usually it\'s cats.)' },
  { main: 'Judge is doing the research.', sub: '(So you don\'t have to. You\'re welcome.)' },
  { main: 'Judge is verifying things.', sub: '(Rumors say the internet has facts. We\'re testing that.)' },
  { main: 'Judge is hitting the books.', sub: '(The books are web servers. Same energy.)' },
  { main: 'Judge is checking the web…', sub: '(Making sure the models didn\'t just make it up. Again.)' },
];

// ---------- Judge model selection ----------

/**
 * Extract a rough parameter-count number from a model id string.
 * E.g. "qwen3-32b-instruct" → 32, "llama-3.1-70b" → 70, "phi-4-mini" → 4.
 * Returns 0 if no size found.
 * @param {string} id
 * @returns {number}
 */
function extractParamSize(id) {
  if (!id) return 0;
  const m = id.match(/(\d+(?:\.\d+)?)\s*[bB]\b/);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * Pick the best judge model from the available model list.
 *
 * Rules (Sequential Model Arena spec):
 *   1. The judge MUST NOT be any of the contestant models.
 *   2. If the user explicitly set a scoring model that isn't a contestant, use it.
 *   3. Otherwise, auto-pick the largest / smartest non-contestant model.
 *   4. Prefer "instruct" models over base models. Prefer larger param counts.
 *   5. If no non-contestant model is available, return { id: null, error: '...' }.
 *
 * @param {Object} opts
 * @param {string} opts.userChoice - User-configured arenaScoringModelId ('' = auto).
 * @param {string[]} opts.contestantIds - Model IDs currently competing (A–D).
 * @param {Array<{ id: string }>} opts.availableModels - Full model list from LM Studio.
 * @returns {{ id: string|null, error?: string, fallback?: boolean }}
 */
export function pickJudgeModel({ userChoice, contestantIds, availableModels }) {
  const contestants = new Set((contestantIds || []).map((s) => s.trim().toLowerCase()).filter(Boolean));
  const isContestant = (id) => contestants.has(id.trim().toLowerCase());

  // User explicitly chose a model
  if (userChoice && userChoice.trim()) {
    if (!isContestant(userChoice)) {
      return { id: userChoice.trim() };
    }
    // User's choice IS a contestant → fall back to auto-pick
  }

  // Auto-pick: find best non-contestant
  const candidates = (availableModels || [])
    .map((m) => m.id)
    .filter((id) => id && !isContestant(id));

  if (candidates.length === 0) {
    return { id: null, error: 'No non-contestant model available for judging. Load an additional model in LM Studio that is not assigned to any Arena slot.' };
  }

  // Rank: prefer instruct, prefer larger param count
  const scored = candidates.map((id) => {
    const lower = id.toLowerCase();
    const size = extractParamSize(id);
    const instructBonus = /instruct|chat/.test(lower) ? 100 : 0;
    return { id, score: size + instructBonus };
  });
  scored.sort((a, b) => b.score - a.score);

  return { id: scored[0].id, fallback: true };
}

// ---------- Standing labels ----------

/**
 * Standing label for a slot: "Leader" | "2nd" | "3rd".
 * @param {string} slot - 'B' | 'C' | 'D'
 * @param {{ B: number, C: number, D: number }} scores
 * @returns {string}
 */
export function arenaStandingLabel(slot, scores) {
  const order = ['A', 'B', 'C', 'D'].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const idx = order.indexOf(slot);
  if (idx === 0) return 'Leader';
  if (idx === 1) return '2nd';
  if (idx === 2) return '3rd';
  if (idx === 3) return '4th';
  return '—';
}
