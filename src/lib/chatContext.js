/**
 * Fit a chat request into the live llama-server window.
 *
 * ATOM's llama-server is --ctx-size 65536 (Qwen3.8's 262144 training length
 * wrecks tok/s). The UI used to send the whole thread anyway, so a cloud
 * conversation of 30k tokens died on the 27B with a raw llama.cpp error.
 */

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 256;
const PER_MESSAGE_OVERHEAD = 4;

/**
 * @param {unknown} content
 * @returns {number}
 */
export function estimateContentTokens(content) {
  if (content == null) return 0;
  if (typeof content === 'string') return Math.ceil(content.length / CHARS_PER_TOKEN);
  if (Array.isArray(content)) {
    let n = 0;
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        n += Math.ceil(String(part).length / CHARS_PER_TOKEN);
        continue;
      }
      if (part.type === 'image_url' || part.image_url) n += IMAGE_TOKENS;
      else if (typeof part.text === 'string') n += Math.ceil(part.text.length / CHARS_PER_TOKEN);
      else n += Math.ceil(JSON.stringify(part).length / CHARS_PER_TOKEN);
    }
    return n;
  }
  if (typeof content === 'object') return Math.ceil(JSON.stringify(content).length / CHARS_PER_TOKEN);
  return Math.ceil(String(content).length / CHARS_PER_TOKEN);
}

/**
 * @param {Array<{ role?: string, content?: unknown, tool_calls?: unknown }>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages) || !messages.length) return 0;
  let n = 0;
  for (const m of messages) {
    n += PER_MESSAGE_OVERHEAD + estimateContentTokens(m?.content);
    if (m?.tool_calls) n += Math.ceil(JSON.stringify(m.tool_calls).length / CHARS_PER_TOKEN);
  }
  return n;
}

/**
 * Drop oldest non-system turns until the prompt fits n_ctx minus generation room.
 * Always keeps system messages and the last user message.
 *
 * @param {object[]} messages
 * @param {{ nCtx: number, maxTokens?: number }} opts
 * @returns {{ messages: object[], tokens: number, originalTokens: number, dropped: number, budget: number, nCtx: number, overflow: boolean }}
 */
export function fitMessagesToContext(messages, { nCtx, maxTokens = 4096 } = {}) {
  const ctx = Math.max(1, Math.floor(Number(nCtx) || 0));
  const gen = Math.max(64, Math.floor(Number(maxTokens) || 4096));
  const reserve = Math.min(gen, Math.max(64, Math.floor(ctx / 2)));
  const budget = Math.max(256, ctx - reserve);
  const list = Array.isArray(messages) ? [...messages] : [];
  const originalTokens = estimateMessagesTokens(list);

  const system = [];
  const rest = [];
  for (const m of list) {
    if (m?.role === 'system') system.push(m);
    else rest.push(m);
  }

  const fits = (rows) => estimateMessagesTokens([...system, ...rows]) <= budget;

  if (fits(rest)) {
    return {
      messages: list,
      tokens: originalTokens,
      originalTokens,
      dropped: 0,
      budget,
      nCtx: ctx,
      overflow: false,
    };
  }

  let work = rest;
  let dropped = 0;
  while (work.length > 1 && !fits(work)) {
    work = work.slice(1);
    dropped += 1;
    if (work[0]?.role === 'assistant' || work[0]?.role === 'tool') {
      work = work.slice(1);
      dropped += 1;
    }
  }

  const tokens = estimateMessagesTokens([...system, ...work]);
  const overflow = !fits(work);
  return {
    messages: [...system, ...work],
    tokens,
    originalTokens,
    dropped,
    budget,
    nCtx: ctx,
    overflow,
  };
}

export const COMPRESS_RATIO = 0.7;

/**
 * @param {number} tokens
 * @param {number} nCtx
 * @returns {boolean}
 */
export function needsCompress(tokens, nCtx) {
  const ctx = Number(nCtx) || 0;
  if (ctx < 1) return false;
  return tokens / ctx >= COMPRESS_RATIO;
}

/**
 * Split older turns off so `keep` fits keepBudget. System messages stay with keep.
 *
 * @param {object[]} messages
 * @param {{ nCtx?: number, keepTokens?: number }} [opts]
 * @returns {{ system: object[], head: object[], keep: object[] }}
 */
export function splitHeadForCompress(messages, { nCtx = 65536, keepTokens } = {}) {
  const keepBudget = Math.max(256, Math.floor(keepTokens ?? (Number(nCtx) || 65536) * 0.4));
  const list = Array.isArray(messages) ? [...messages] : [];
  const system = list.filter((m) => m?.role === 'system');
  const rest = list.filter((m) => m?.role !== 'system');
  let keep = [...rest];
  while (keep.length > 2 && estimateMessagesTokens([...system, ...keep]) > keepBudget) {
    keep = keep.slice(1);
    if (keep[0]?.role === 'assistant' || keep[0]?.role === 'tool') keep = keep.slice(1);
  }
  const head = rest.slice(0, Math.max(0, rest.length - keep.length));
  return { system, head, keep };
}

/**
 * @param {object[]} messages
 * @param {(content: unknown) => string} toText
 * @returns {string}
 */
export function transcriptForSummary(messages, toText) {
  const textOf = typeof toText === 'function' ? toText : (c) => (typeof c === 'string' ? c : '');
  return (messages || [])
    .map((m) => {
      const body = textOf(m?.content).replace(/\s+/g, ' ').trim();
      if (!body) return '';
      const clipped = body.length > 1200 ? `${body.slice(0, 1160)} … ${body.slice(-40)}` : body;
      return `${m.role || 'user'}: ${clipped}`;
    })
    .filter(Boolean)
    .join('\n');
}
