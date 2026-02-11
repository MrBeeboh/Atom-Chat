/**
 * @file arenaLogic.js
 * @description Pure logic for Arena: Q&A parsing, judge score parsing, loop detection,
 * score history tracking, system prompt templates, and judge prompt building.
 * Extracted from DashboardArena.svelte for testability and reuse.
 */

// ---------- System prompt templates ----------
export const ARENA_SYSTEM_PROMPT_TEMPLATES = [
  { name: '—', prompt: '' },
  { name: 'General', prompt: 'You are a helpful assistant.' },
  { name: 'Code', prompt: 'You are an expert programmer. Be concise. Prefer code over prose when relevant.' },
  { name: 'Research', prompt: 'You are a thorough researcher. Cite sources when possible. Structure answers with clear sections.' },
  { name: 'Creative', prompt: 'You are a creative writer. Use vivid language and varied structure. Be engaging and original.' },
  {
    name: 'Arena contestant',
    prompt: 'You are a contestant in a competition against other AI models. You will receive questions and contest rules. You must strictly adhere to the rules; breaking them (e.g. going over the allowed line count, ignoring format, or violating instructions) can result in a score of zero. Answer each question concisely, accurately, and within the stated constraints. Do not acknowledge the competition in your answer—just answer the question.',
  },
  {
    name: 'Arena judge',
    prompt: 'You are the judge in an AI model competition. You will receive the question, an optional answer key, and each competing model\'s response. Score each response 1–10 (10 = best) with one short reason, based on accuracy and adherence to the answer key (or your own knowledge if no key is provided). Your reply must contain only the score lines (e.g. Model B: 7/10 - reason). No preamble, no <think>, no lengthy analysis—just the scores.',
  },
];

// ---------- Q&A parser ----------

/**
 * Parse "Questions & answers" text into { questions, answers }.
 * Blocks are split by lines starting with a number (1. or 2) etc.).
 * Within a block, an optional "Answer:" line starts the answer; rest is question.
 * If no Answer: is given for a question, answers[i] is '' (judge uses web or own knowledge).
 * @param {string} text
 * @returns {{ questions: string[], answers: string[] }}
 */
export function parseQuestionsAndAnswers(text) {
  if (!text || typeof text !== 'string') return { questions: [], answers: [] };
  const blocks = text.split(/\n\s*(?=\d+[.)]\s*)/).filter((b) => b.trim().length > 0);
  const questions = [];
  const answers = [];
  for (const block of blocks) {
    const lines = block.split(/\n/);
    const first = lines[0] || '';
    const numberStripped = first.replace(/^\s*\d+[.)]\s*/, '').trim();
    let questionLines = [];
    let answerLines = [];
    let foundAnswer = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*Answer:\s*/i.test(line)) {
        foundAnswer = true;
        answerLines.push(line.replace(/^\s*Answer:\s*/i, '').trim());
        for (let j = i + 1; j < lines.length; j++) answerLines.push(lines[j]);
        break;
      }
      if (i === 0) questionLines.push(numberStripped);
      else questionLines.push(line);
    }
    const q = questionLines.join('\n').trim();
    const a = answerLines.join('\n').trim();
    if (q.length > 0) {
      questions.push(q);
      answers.push(a);
    }
  }
  return { questions, answers };
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
 * Parse judge output for "Model B: 7/10" lines; return { B: 7, C: 5, ... }.
 * Strips <think> blocks before parsing (some models emit them despite instructions).
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function parseJudgeScores(text) {
  if (!text || typeof text !== 'string') return {};
  // Strip <think> blocks so they don't interfere with score parsing
  const cleaned = stripThinkBlocks(text);
  const out = {};
  const re = /Model\s+([B-D]):\s*(\d+)\s*\/\s*10/gi;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const slot = m[1].toUpperCase();
    const n = parseInt(m[2], 10);
    if (slot >= 'B' && slot <= 'D' && n >= 0 && n <= 10) out[slot] = n;
  }
  return out;
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
 * @returns {{ B: number, C: number, D: number }}
 */
export function computeTotals(history) {
  const totals = { B: 0, C: 0, D: 0 };
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
  const firstSlot = competingSlots[0] || 'B';
  const feedback = typeof judgeFeedback === 'string' ? judgeFeedback.trim() : '';
  const customInstr = typeof judgeInstructions === 'string' ? judgeInstructions.trim() : '';

  const parts = [
    customInstr || 'You are a judge. Score each model response 1-10 (10 = best) with one short reason.',
    '',
    `COMPETING MODELS (authoritative—do not guess): This round has exactly ${competingSlots.length} model(s): ${competingList}. You must output exactly one line for each of these, in this order: ${competingList}. Do not score Model A (the judge). Do not add or mention Model E or any other model. Only ${competingList}. If a model has no response below, write: Model X: 0/10 - No response.`,
    '',
    answerKeyTrimmed
      ? 'BASIS FOR SCORING: An ANSWER KEY is provided below. Judge whether each model\'s response is SUBSTANTIVELY CORRECT—meaning the factual content matches the answer key. Ignore trivial differences like capitalization, punctuation, phrasing, formatting, or word order. "ampere" and "Ampere" are the same answer. "Electromagnetic force" and "electromagnetic force" are the same answer. Focus ONLY on whether the model gave the right factual answer. A correct answer = 8-10. A partially correct answer = 4-7. A wrong answer = 1-3. No response = 0.'
      : 'BASIS FOR SCORING: No answer key was provided. Use the WEB SEARCH section below (if present) to fact-check, or use your own knowledge to evaluate correctness. Focus on factual accuracy. Ignore trivial formatting differences.',
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
    ? `You are a judge. An answer key is provided. A response is CORRECT if it gives the same factual answer as the key, regardless of capitalization, phrasing, or formatting. "ampere" = "Ampere" = correct. Score exactly ${competingSlots.length} model(s): ${competingList}. Output exactly one line for each, in that order. No other models. No <think>, no chain-of-thought, no analysis. Start with "Model ${firstSlot}:".`
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

// ---------- Standing labels ----------

/**
 * Standing label for a slot: "Leader" | "2nd" | "3rd".
 * @param {string} slot - 'B' | 'C' | 'D'
 * @param {{ B: number, C: number, D: number }} scores
 * @returns {string}
 */
export function arenaStandingLabel(slot, scores) {
  const order = ['B', 'C', 'D'].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const idx = order.indexOf(slot);
  if (idx === 0) return 'Leader';
  if (idx === 1) return '2nd';
  if (idx === 2) return '3rd';
  return '—';
}
