/**
 * OpenAI-compatible chat completion (streaming and non-streaming) for local
 * (LM Studio / llama.cpp) and cloud providers. Extracted from api.js.
 */
import {
  getBaseAndAuth,
  resolveCloudStreamTimeoutMs,
  CLOUD_REQUEST_TIMEOUT_MS,
  normalizeLocalLmBaseUrl,
  joinUrl,
} from '$lib/apiConfig.js';
import {
  isQwen38FlashNextSelection,
  isDeepinfraModel,
  isDeepSeekModel,
  isGrokModel,
  resolveModelId,
  localModelIdForOpenAIRequest,
  localChatModelIdForRequest,
  clampChatMaxTokens,
} from '$lib/modelIdUtils.js';
import { probeLlamaRouterModelsList } from '$lib/llamaRouter.js';
import { resolveEffectiveLocalChatModelId, probeLmsRestModelsList } from '$lib/modelListing.js';
import { ensureLocalModelReadyForChat } from '$lib/modelLoadUnload.js';
import { FLASH_NEXT_CHAT_BASE, firstTokenTimeoutError, flashNextSlotIsAlive } from '$lib/flashNext.js';
import { parseChatApiError } from '$lib/chatErrorUtils.js';
import { applyThinkingToChatBody, applyThinkingToGrokBody } from '$lib/thinkingControls.js';
import { normalizeChatUsage } from '$lib/modelPricing.js';
import { recordDeepSeekCacheUsage } from '$lib/deepSeekCache.js';
import { mergeToolCallDeltas, finalizeToolCalls } from '$lib/desktopHost.js';
import { streamGrokResponsesApi, parseGrokResponseOutput, GROK_REALTIME_TOOLS, XAI_RESPONSES_BASE } from '$lib/grok.js';

/** True when any message part is an image_url (vision turn). */
export function messagesContainImages(messages) {
  if (!Array.isArray(messages)) return false;
  for (const m of messages) {
    const c = m?.content;
    if (!Array.isArray(c)) continue;
    for (const part of c) {
      if (part?.type === 'image_url' || part?.image_url) return true;
    }
  }
  return false;
}

/** First-token budget. Flash-Next image prefill and long local prompts routinely exceed 30s. */
export function firstTokenBudgetMs(model, messages, options = {}) {
  const vision = messagesContainImages(messages);
  // Text was falsely aborting healthy ~24 t/s decode when SSE lagged (2026-10-02).
  if (isQwen38FlashNextSelection(model)) return vision ? 120000 : 90000;
  if (model && String(model).includes(':')) {
    return Math.max(vision ? 90000 : 60000, resolveCloudStreamTimeoutMs(options));
  }
  return vision ? 90000 : 45000;
}

/**
 * OpenAI-compatible streaming must ask for the final usage chunk. DeepInfra also
 * accepts per-event usage so the Arena footer can update while tokens arrive.
 * @param {string} [modelId]
 */
export function openaiChatStreamOptions(modelId) {
  const opts = { include_usage: true };
  if (isDeepinfraModel(modelId)) opts.continuous_usage_stats = true;
  return opts;
}

function reasoningDeltaText(delta) {
  if (!delta || typeof delta !== 'object') return '';
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) return delta.reasoning_content;
  if (typeof delta.reasoning === 'string' && delta.reasoning) return delta.reasoning;
  if (delta.reasoning && typeof delta.reasoning === 'object') {
    if (typeof delta.reasoning.content === 'string' && delta.reasoning.content) return delta.reasoning.content;
    if (typeof delta.reasoning.text === 'string' && delta.reasoning.text) return delta.reasoning.text;
  }
  if (typeof delta.thinking === 'string' && delta.thinking) return delta.thinking;
  return '';
}

/**
 * OpenAI-compatible chat URL. llama.cpp router honors ?autoload=true: LRU-evict + load + wait
 * happen inside the chat request (the fast path). Safe no-op if the model is already loaded.
 * @param {string} base
 * @param {string} model
 * @param {{ routerAutoload?: boolean }} [opts]
 */
export function openaiChatCompletionsUrl(base, model, opts = {}) {
  const flashNext = isQwen38FlashNextSelection(model);
  // Chat the already-loaded server on :8081. The :8080 proxy only exists to
  // list this id; sending completions there can sit until the proxy's 180s
  // timeout with zero tokens. Disk-path IDs are rewritten to the alias.
  const normalizedBase = flashNext ? FLASH_NEXT_CHAT_BASE : normalizeLocalLmBaseUrl(base);
  if (isDeepinfraModel(model)) return joinUrl(normalizedBase, 'chat/completions');
  const path = normalizedBase.endsWith('/v1')
    ? joinUrl(normalizedBase, 'chat/completions')
    : joinUrl(normalizedBase, 'v1/chat/completions');
  if (opts.routerAutoload && !flashNext) return `${path}?autoload=true`;
  return path;
}

/**
 * Decode (token-generation) tok/s. Prefers llama.cpp `timings.predicted_per_second`
 * so GGUF load + prompt eval are not counted as generation.
 * @param {{ timings?: { predicted_per_second?: number }, completionTokens?: number, decodeMs?: number, elapsedMs?: number }} opts
 * @returns {number|null}
 */
export function decodeTokPerSec(opts = {}) {
  const fromServer = Number(opts.timings?.predicted_per_second);
  if (Number.isFinite(fromServer) && fromServer > 0) return fromServer;
  const tokens = Number(opts.completionTokens);
  const ms = Number(opts.decodeMs > 0 ? opts.decodeMs : opts.elapsedMs);
  if (!(tokens > 0) || !(ms > 0)) return null;
  return tokens / (ms / 1000);
}

/**
 * Qwen-style reasoning models often put the entire reply in `reasoning_content`
 * and leave `content` empty — Arena Build then thinks the judge returned no JSON.
 */
function assistantTextFromChatCompletion(data) {
  const msg = data?.choices?.[0]?.message;
  if (!msg || typeof msg !== 'object') return '';
  const content = msg.content != null ? String(msg.content).trim() : '';
  const reasoning = msg.reasoning_content != null ? String(msg.reasoning_content).trim() : '';
  if (content && reasoning) return `${reasoning}\n${content}`;
  return content || reasoning;
}

/**
 * Single request/response chat completion (non-streaming). Returns full assistant message.
 * Use for short advisory requests (e.g. "suggest optimal settings").
 * @param {Object} opts
 * @param {string} opts.model - Model id
 * @param {Array<{ role: string, content: string }>} opts.messages
 * @param {Object} [opts.options] - temperature, max_tokens, etc.
 * @returns {Promise<{ content: string, usage?: object }>}
 */
export async function requestChatCompletion({ model, messages, options = {} }) {
  if (isGrokModel(model)) {
    const { headers: authHeaders } = getBaseAndAuth(model);
    const resolvedModel = resolveModelId(model);
    const rawMax = options.max_tokens ?? 1024;
    const maxTokens = Math.max(1, Math.min(8192, Number(rawMax) || 1024));
    const body = {
      model: resolvedModel,
      input: messages,
      stream: false,
      max_output_tokens: maxTokens,
      temperature: options.temperature ?? 0.3,
      tools: GROK_REALTIME_TOOLS,
      tool_choice: 'auto',
      enable_image_understanding: true,
    };
    applyThinkingToGrokBody(body, { model, options });
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${XAI_RESPONSES_BASE}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(parseChatApiError(res.status, text, model));
      }
      const data = await res.json();
      const content = parseGrokResponseOutput(data);
      return { content, usage: data.usage };
    } catch (err) {
      clearTimeout(to);
      throw err;
    }
  }
  const { base, headers: authHeaders } = getBaseAndAuth(model);
  const isCloud = model && String(model).includes(':');
  let resolvedModel = resolveModelId(model);
  let router = false;
  if (!isCloud) {
    await ensureLocalModelReadyForChat(model);
    const eff = resolveModelId(await resolveEffectiveLocalChatModelId(model));
    router = await probeLlamaRouterModelsList();
    resolvedModel = router ? eff : localModelIdForOpenAIRequest(eff);
    resolvedModel = localChatModelIdForRequest(model, resolvedModel);
  }
  const lmsHasRestModels = !isCloud && (await probeLmsRestModelsList());
  const url = openaiChatCompletionsUrl(base, model, { routerAutoload: router });
  const headers = { 'Content-Type': 'application/json', ...authHeaders };
  const rawMax = options.max_tokens ?? 1024;
  const maxTokens = isCloud ? Math.max(1, Math.min(8192, Number(rawMax) || 1024)) : rawMax;
  const body = {
    model: resolvedModel,
    messages,
    stream: false,
    temperature: options.temperature ?? 0.3,
    max_tokens: maxTokens,
    ...(options.top_p != null && { top_p: options.top_p }),
    ...(!isCloud && options.top_k != null && { top_k: options.top_k }),
    ...(!isCloud && options.repeat_penalty != null && { repeat_penalty: options.repeat_penalty }),
    ...(lmsHasRestModels && options.presence_penalty != null && { presence_penalty: options.presence_penalty }),
    ...(lmsHasRestModels && options.frequency_penalty != null && { frequency_penalty: options.frequency_penalty }),
  };
  applyThinkingToChatBody(body, { model, options, local: !isCloud });
  const fetchOpts = { method: 'POST', headers, body: JSON.stringify(body) };
  if (isCloud) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
    fetchOpts.signal = ctrl.signal;
    try {
      const res = await fetch(url, fetchOpts);
      clearTimeout(to);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(parseChatApiError(res.status, text, model));
      }
      const data = await res.json();
      if (isDeepSeekModel(model)) {
        recordDeepSeekCacheUsage(data.usage, { site: 'requestChatCompletion', model });
      }
      return { content: assistantTextFromChatCompletion(data), usage: data.usage };
    } catch (err) {
      clearTimeout(to);
      throw err;
    }
  }
  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(parseChatApiError(res.status, text, model));
  }
  const data = await res.json();
  return { content: assistantTextFromChatCompletion(data), usage: data.usage };
}

/**
 * Stream a chat completion from LM Studio.
 * @param {Object} opts
 * @param {string} opts.model - Model id
 * @param {Array<{ role: string, content: string|Array }>} opts.messages
 * @param {Object} [opts.options] - temperature, max_tokens, ttl, request_timeout_ms (cloud/Grok only, ms, 60s–15m), etc.
 * @param {(chunk: string) => void} opts.onChunk
 * @param {(usage: { prompt_tokens?: number, completion_tokens?: number }) => void} [opts.onUsage]
 * @param {() => void} [opts.onDone] - Called when stream ends ([DONE] line or connection closed). Use to clear busy UI immediately.
 * @param {(ref: { image_id: string }) => void} [opts.onImageRef] - (Grok only) Called when a <render_searched_image image_id="..."> is found in the stream.
 * @param {AbortSignal} [opts.signal] - AbortSignal to cancel the stream
 * @param {Array} [opts.tools] - OpenAI-style tools (local Documents host, etc.)
 * @returns {Promise<{ usage?: object, elapsedMs: number, aborted?: boolean, finishReason?: string|null, toolCalls?: Array }>}
 */
export async function streamChatCompletion({ model, messages, options = {}, onChunk, onUsage, onDone, onImageRef, signal, tools }) {
  if (isGrokModel(model)) {
    return streamGrokResponsesApi({ model, messages, options, onChunk, onUsage, onDone, onImageRef, signal });
  }
  let usage = null;
  let timings = null;
  let firstTokenAt = 0;
  let firstTokenTimer = null;
  let doneCalled = false;
  let finishReason = null;
  const toolAcc = [];
  const callOnDone = () => {
    if (!doneCalled) {
      doneCalled = true;
      onDone?.();
    }
  };
  const { base, headers: authHeaders } = getBaseAndAuth(model);
  const isCloud = model && String(model).includes(':');
  let resolvedModel = resolveModelId(model);
  let router = false;
  if (!isCloud) {
    // Preload so Arena's generation timeout is not eaten by GGUF load.
    // ?autoload=true still LRU-evicts if preload was skipped.
    await ensureLocalModelReadyForChat(model, signal);
    const eff = resolveModelId(await resolveEffectiveLocalChatModelId(model));
    router = await probeLlamaRouterModelsList();
    resolvedModel = router ? eff : localModelIdForOpenAIRequest(eff);
    resolvedModel = localChatModelIdForRequest(model, resolvedModel);
  }
  // Clock starts after load — otherwise Arena t/s includes the GGUF swap.
  const startTime = Date.now();
  let thinkOpen = false;
  let answerStarted = false;
  let cacheLogged = false;
  const markToken = () => {
    if (!firstTokenAt) firstTokenAt = Date.now();
    if (firstTokenTimer) {
      clearTimeout(firstTokenTimer);
      firstTokenTimer = null;
    }
  };
  const emitReasoning = (text) => {
    if (!text) return;
    // DeepSeek V4 flash often emits more reasoning AFTER the final answer.
    // Reopening <think> then looks like the reply vanished back into the spinner.
    if (answerStarted) return;
    markToken();
    if (!thinkOpen) {
      thinkOpen = true;
      onChunk('<think>');
    }
    onChunk(text);
  };
  const emitContent = (text) => {
    if (!text) return;
    markToken();
    if (thinkOpen) {
      thinkOpen = false;
      onChunk('</think>\n');
    }
    answerStarted = true;
    onChunk(text);
  };
  const closeThink = () => {
    if (!thinkOpen) return;
    thinkOpen = false;
    onChunk('</think>\n');
  };
  const finishPayload = (extra = {}) => {
    closeThink();
    if (isDeepSeekModel(model) && !cacheLogged) {
      cacheLogged = true;
      recordDeepSeekCacheUsage(usage, { site: 'streamChatCompletion', model });
    }
    return {
      usage,
      timings,
      elapsedMs: Date.now() - startTime,
      decodeMs: firstTokenAt ? Date.now() - firstTokenAt : Date.now() - startTime,
      finishReason,
      toolCalls: finalizeToolCalls(toolAcc),
      ...extra,
    };
  };
  const lmsHasRestModels = !isCloud && (await probeLmsRestModelsList());
  const streamUrl = openaiChatCompletionsUrl(base, model, { routerAutoload: router });
  const headers = { 'Content-Type': 'application/json', ...authHeaders };
  const rawMax = options.max_tokens ?? 4096;
  const maxTokens = clampChatMaxTokens(rawMax, { cloud: isCloud });
  const streamBody = {
    model: resolvedModel,
    messages,
    stream: true,
    temperature: options.temperature ?? 0.7,
    max_tokens: maxTokens,
    ...(options.top_p != null && { top_p: options.top_p }),
    ...(options.stop?.length && { stop: options.stop }),
    ...(Array.isArray(tools) && tools.length ? { tools, tool_choice: options.tool_choice || 'auto' } : {}),
    ...(options._retriedWithoutStreamOptions ? {} : { stream_options: openaiChatStreamOptions(model) }),
  };
  if (!isCloud) {
    if (options.top_k != null) streamBody.top_k = options.top_k;
    if (options.repeat_penalty != null) streamBody.repeat_penalty = options.repeat_penalty;
    if (lmsHasRestModels) {
      if (options.presence_penalty != null) streamBody.presence_penalty = options.presence_penalty;
      if (options.frequency_penalty != null) streamBody.frequency_penalty = options.frequency_penalty;
      if (options.ttl != null && Number(options.ttl) > 0) streamBody.ttl = Number(options.ttl);
    }
  }
  applyThinkingToChatBody(streamBody, { model, options, local: !isCloud });
  const multimodal = messagesContainImages(messages);
  const firstTokenMs = firstTokenBudgetMs(model, messages, options);
  const flashNext = isQwen38FlashNextSelection(model);
  const firstTokenCtrl = new AbortController();
  const armFirstTokenTimer = () => {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    firstTokenTimer = setTimeout(async () => {
      if (firstTokenAt) return;
      // Healthy Flash-Next decode can outrun SSE parsing; do not abort a live slot.
      if (flashNext && (await flashNextSlotIsAlive())) {
        armFirstTokenTimer();
        return;
      }
      if (!firstTokenAt) firstTokenCtrl.abort();
    }, firstTokenMs);
  };
  armFirstTokenTimer();
  const armFirstTokenAbort = (src) => {
    if (!src) return;
    if (src.aborted) firstTokenCtrl.abort();
    else src.addEventListener('abort', () => firstTokenCtrl.abort());
  };
  let effectiveSignal = firstTokenCtrl.signal;
  let timeoutId = null;
  if (isCloud) {
    timeoutId = setTimeout(() => firstTokenCtrl.abort(), resolveCloudStreamTimeoutMs(options));
    armFirstTokenAbort(signal);
  } else {
    armFirstTokenAbort(signal);
  }

  try {
    const res = await fetch(streamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(streamBody),
      signal: effectiveSignal,
    });
    if (timeoutId) clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseChatApiError(res.status, text, model));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const handleDataLine = (trimmed) => {
      if (!trimmed.startsWith('data: ')) return false;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') {
        callOnDone();
        return true;
      }
      try {
        const parsed = JSON.parse(payload);
        const choice = parsed.choices?.[0];
        // Any SSE choice proves the stream is alive (role-only / null content included).
        if (choice) markToken();
        const delta = choice?.delta;
        const reasoningDelta = reasoningDeltaText(delta);
        if (reasoningDelta) emitReasoning(reasoningDelta);
        if (delta?.content) emitContent(delta.content);
        if (delta?.tool_calls) mergeToolCallDeltas(toolAcc, delta.tool_calls);
        if (Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length) {
          toolAcc.length = 0;
          mergeToolCallDeltas(toolAcc, choice.message.tool_calls.map((c, index) => ({ ...c, index })));
        }
        if (parsed.timings && typeof parsed.timings === 'object') timings = parsed.timings;
        if (choice?.finish_reason != null) {
          finishReason = choice.finish_reason;
          callOnDone();
        }
        const nextUsage = normalizeChatUsage(parsed.usage);
        if (nextUsage) {
          usage = nextUsage;
          onUsage?.(nextUsage);
          // OpenAI's final usage chunk has empty choices and no finish_reason.
          // Do not treat per-token DeepInfra usage as the end of the stream.
          if (!parsed.choices || parsed.choices.length === 0) callOnDone();
        }
      } catch (_) { }
      return false;
    };
    const consume = (chunkText, end = false) => {
      buffer += chunkText;
      const lines = buffer.split('\n');
      if (end) {
        buffer = '';
        for (const line of lines) {
          if (handleDataLine(line.trim())) return true;
        }
        return false;
      }
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (handleDataLine(line.trim())) return true;
      }
      return false;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          consume(decoder.decode(), true);
          callOnDone();
          break;
        }
        if (consume(decoder.decode(value, { stream: true }))) break;
      }
    } catch (readErr) {
      if (readErr?.name === 'AbortError') {
        if (!firstTokenAt && !signal?.aborted) throw firstTokenTimeoutError(model, { multimodal, waitMs: firstTokenMs });
        return finishPayload({ aborted: true });
      }
      throw readErr;
    }
    return finishPayload();
  } catch (err) {
    if (err?.name === 'FirstTokenTimeout') throw err;
    if (err?.name === 'AbortError') {
      if (!firstTokenAt && !signal?.aborted) throw firstTokenTimeoutError(model, { multimodal, waitMs: firstTokenMs });
      return finishPayload({ aborted: true });
    }
    const msg = err?.message || '';
    if (!options._retriedWithoutStreamOptions && /stream_options|include_usage|unrecognized|unknown (field|argument)/i.test(msg)) {
      return streamChatCompletion({
        model,
        messages,
        options: { ...options, _retriedWithoutStreamOptions: true },
        onChunk,
        onUsage,
        onDone,
        onImageRef,
        signal,
        tools,
      });
    }
    if (Array.isArray(tools) && tools.length && !options._retriedWithoutTools && /tool|jinja|system message must be at the beginning/i.test(msg)) {
      return streamChatCompletion({
        model,
        messages,
        options: { ...options, _retriedWithoutTools: true },
        onChunk,
        onUsage,
        onDone,
        onImageRef,
        signal,
        tools,
      });
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
  }
}
