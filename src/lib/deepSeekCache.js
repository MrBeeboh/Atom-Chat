/**
 * DeepSeek disk KV cache: exact-match prefix from token 0.
 * Docs: https://api-docs.deepseek.com/guides/kv_cache
 * Usage fields: prompt_cache_hit_tokens, prompt_cache_miss_tokens
 * (OpenAI-style cached_tokens is accepted as a hit alias).
 */
import { stripThinkingBlocks } from '$lib/markdown.js';
import { repairOpenAiToolTurns } from '$lib/desktopHost.js';

/** @type {{ site: string, model: string, hit: number, miss: number, prompt: number, rate: number|null }[]} */
const usageLog = [];

export function resetDeepSeekCacheLog() {
  usageLog.length = 0;
}

export function getDeepSeekCacheLog() {
  return usageLog.slice();
}

export function summarizeDeepSeekCacheLog(rows = usageLog) {
  const hit = rows.reduce((s, r) => s + (r.hit || 0), 0);
  const miss = rows.reduce((s, r) => s + (r.miss || 0), 0);
  const denom = hit + miss;
  return {
    calls: rows.length,
    hit,
    miss,
    rate: denom > 0 ? hit / denom : null,
  };
}

/**
 * Normalize DeepSeek / OpenAI-compatible cache fields from a final usage object.
 * @param {object|null|undefined} usage
 * @returns {{ hit: number, miss: number, prompt: number, cachedTokens: number, fieldNames: string[] }}
 */
export function extractDeepSeekCacheUsage(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const names = [];
  const hitRaw =
    u.prompt_cache_hit_tokens ??
    u.prompt_cache_hit ??
    u.cached_tokens ??
    u.cache_read_input_tokens ??
    null;
  if (u.prompt_cache_hit_tokens != null) names.push('prompt_cache_hit_tokens');
  else if (u.prompt_cache_hit != null) names.push('prompt_cache_hit');
  else if (u.cached_tokens != null) names.push('cached_tokens');
  else if (u.cache_read_input_tokens != null) names.push('cache_read_input_tokens');

  const missRaw =
    u.prompt_cache_miss_tokens ??
    u.prompt_cache_miss ??
    u.cache_creation_input_tokens ??
    null;
  if (u.prompt_cache_miss_tokens != null) names.push('prompt_cache_miss_tokens');
  else if (u.prompt_cache_miss != null) names.push('prompt_cache_miss');
  else if (u.cache_creation_input_tokens != null) names.push('cache_creation_input_tokens');

  const prompt = Number(u.prompt_tokens) || 0;
  const hit = hitRaw != null ? Number(hitRaw) || 0 : 0;
  let miss = missRaw != null ? Number(missRaw) || 0 : 0;
  if (missRaw == null && prompt > 0 && hitRaw != null) {
    miss = Math.max(0, prompt - hit);
    names.push('prompt_tokens-hit');
  }
  return { hit, miss, prompt, cachedTokens: hit, fieldNames: names };
}

/**
 * Log final-chunk usage only. Safe to call with empty usage (no-ops into the log).
 * @param {object|null|undefined} usage
 * @param {{ site?: string, model?: string }} [meta]
 */
export function recordDeepSeekCacheUsage(usage, meta = {}) {
  if (!usage || typeof usage !== 'object') return null;
  const extracted = extractDeepSeekCacheUsage(usage);
  const denom = extracted.hit + extracted.miss;
  const row = {
    site: meta.site || 'chat',
    model: String(meta.model || ''),
    hit: extracted.hit,
    miss: extracted.miss,
    prompt: extracted.prompt,
    rate: denom > 0 ? extracted.hit / denom : null,
    fieldNames: extracted.fieldNames,
  };
  usageLog.push(row);
  if (typeof console !== 'undefined' && console.debug) {
    const pct = row.rate == null ? 'n/a' : `${(row.rate * 100).toFixed(0)}%`;
    console.debug(
      `[DeepSeek cache] ${row.site} hit=${row.hit} miss=${row.miss} rate=${pct} fields=${row.fieldNames.join(',') || 'none'}`,
    );
  }
  return row;
}

function sanitizeContentForApi(content, { stripThinking = false } = {}) {
  if (typeof content === 'string') {
    return stripThinking ? stripThinkingBlocks(content) : content;
  }
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part?.type === 'text' && typeof part.text === 'string') {
      return stripThinking ? { ...part, text: stripThinkingBlocks(part.text) } : part;
    }
    if (part?.type === 'image_url') return { type: 'text', text: '[Image attached]' };
    return part;
  });
}

/**
 * Wire payload for chat completions. DeepSeek disk cache needs byte-identical
 * prior turns, so do not strip assistant thinking on DeepSeek follow-ups.
 * @param {object} opts
 * @param {Array} opts.msgs
 * @param {string} [opts.systemPrompt]
 * @param {boolean} [opts.stripAssistantThinking]
 */
export function buildChatApiMessages({ msgs, systemPrompt, stripAssistantThinking = true } = {}) {
  const list = Array.isArray(msgs) ? msgs : [];
  const sanitized = list.map((m, i) => {
    const isLastUser = i === list.length - 1 && m.role === 'user';
    const row = {
      role: m.role,
      content: isLastUser
        ? m.content
        : sanitizeContentForApi(m.content, {
            stripThinking: stripAssistantThinking && m.role === 'assistant',
          }),
    };
    if (m.tool_calls) row.tool_calls = m.tool_calls;
    if (m.tool_call_id) row.tool_call_id = m.tool_call_id;
    return row;
  });
  const out = sanitized.filter((m) => {
    if (m.role === 'system' || m.role === 'tool') return true;
    if (m.tool_calls?.length) return true;
    if (typeof m.content === 'string') return m.content.trim().length > 0;
    if (Array.isArray(m.content)) return m.content.length > 0;
    return false;
  });
  if (systemPrompt?.trim()) out.unshift({ role: 'system', content: systemPrompt.trim() });
  return repairOpenAiToolTurns(out);
}

/** Stable JSON for prefix compare (messages + optional tools). */
export function deepSeekRequestPrefixKey(messages, tools) {
  return JSON.stringify({
    messages: messages || [],
    tools: Array.isArray(tools) && tools.length ? tools : null,
  });
}

/**
 * True when nextMessages starts with prevMessages (exact-match prefix).
 * Models sliding-window drops as a miss — caller should label those separately.
 */
export function messagesShareExactPrefix(prevMessages, nextMessages) {
  const prev = Array.isArray(prevMessages) ? prevMessages : [];
  const next = Array.isArray(nextMessages) ? nextMessages : [];
  if (prev.length === 0 || next.length < prev.length) return false;
  return JSON.stringify(next.slice(0, prev.length)) === JSON.stringify(prev);
}

/**
 * Follow-up hit: everything except the latest user turn equals the prior request
 * plus the stored assistant reply.
 */
export function followUpPrefixHits(priorRequestMessages, assistantReply, nextRequestMessages) {
  const continued = [...(priorRequestMessages || []), assistantReply];
  const nextPrefix = (nextRequestMessages || []).slice(0, continued.length);
  return JSON.stringify(nextPrefix) === JSON.stringify(continued);
}
