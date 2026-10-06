/**
 * xAI / Grok integration: Responses API streaming and image generation. Extracted
 * from api.js. `parseGrokResponseOutput`, `GROK_REALTIME_TOOLS`, and `XAI_RESPONSES_BASE`
 * are re-used by the OpenAI-compatible chat path.
 */
import {
  getBaseAndAuth,
  resolveCloudStreamTimeoutMs,
  CLOUD_REQUEST_TIMEOUT_MS,
  localStorageOrVite,
} from '$lib/apiConfig.js';
import { resolveModelId } from '$lib/modelIdUtils.js';
import { parseChatApiError } from '$lib/chatErrorUtils.js';
import { normalizeChatUsage } from '$lib/modelPricing.js';
import { applyThinkingToGrokBody } from '$lib/thinkingControls.js';

/** xAI Responses API base (same host as chat; path is /responses). */
export const XAI_RESPONSES_BASE = 'https://api.x.ai/v1';

/** xAI Image generations endpoint (separate from chat; creates new images from prompt). */
const XAI_IMAGES_GENERATIONS_URL = 'https://api.x.ai/v1/images/generations';

/** Built-in tools for real-time web, X, and image search (server-side execution by xAI). */
/** Grok Responses API: only web_search and x_search are supported. search_images is not a valid tool type. */
export const GROK_REALTIME_TOOLS = [
  { type: 'web_search' },
  { type: 'x_search' },
];

/**
 * Parse content from xAI Responses API non-stream response (output array or choices).
 */
export function parseGrokResponseOutput(data) {
  if (data.choices?.[0]?.message?.content != null) {
    return String(data.choices[0].message.content).trim();
  }
  const output = data.output;
  if (!Array.isArray(output)) return '';
  let text = '';
  for (const item of output) {
    if (item?.type === 'message' && item.content) {
      const parts = Array.isArray(item.content) ? item.content : [item.content];
      for (const p of parts) {
        if (p?.type === 'output_text' && p.text != null) text += p.text;
        else if (typeof p?.text === 'string') text += p.text;
      }
    }
  }
  return text.trim();
}

/**
 * Generate images from a text prompt via xAI Images API (Grok Imagine).
 * Uses POST https://api.x.ai/v1/images/generations; requires Grok API key.
 * Do NOT send 'size' — use aspect_ratio and resolution per xAI docs (Feb 2026).
 * @param {Object} opts
 * @param {string} opts.prompt - Text prompt for image generation
 * @param {number} [opts.n=1] - Number of images (1–3 for variations)
 * @param {string} [opts.aspect_ratio='1:1'] - '1:1', '16:9', '9:16', 'auto', etc.
 * @param {string} [opts.resolution='1k'] - '1k' or '2k'
 * @param {string} [opts.response_format='url'] - 'url' or 'b64_json'
 * @returns {Promise<{ data: Array<{ url?: string, b64_json?: string }> }>}
 */
export async function requestGrokImageGeneration({ prompt, n = 1, aspect_ratio = '1:1', resolution = '1k', response_format = 'url', apiKey, modelId }) {
  const key = (apiKey || '').trim() || localStorageOrVite('grokApiKey', 'VITE_GROK_API_KEY');
  if (!key) throw new Error('Grok API key required. Add it in Settings → Cloud APIs.');
  const body = {
    model: modelId || 'grok-imagine-image',
    prompt: String(prompt).trim(),
    n: Math.max(1, Math.min(10, Number(n) || 1)),
    aspect_ratio: aspect_ratio || '1:1',
    resolution: resolution || '1k',
    response_format,
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(XAI_IMAGES_GENERATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseChatApiError(res.status, text, `grok:${body.model}`));
    }
    return res.json();
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/** Regex to extract <render_searched_image image_id="..." size="..."> from stream deltas (Grok image search). */
const GROK_RENDER_IMAGE_RE = /<render_searched_image\s+image_id=["']?([^"'\s>]+)["']?(?:\s+size=["']?([^"'\s>]*)["']?)?\s*\/?>/gi;

/**
 * Stream Grok via xAI Responses API with web_search + x_search (real-time). Server runs tools; we parse SSE.
 * When enable_image_understanding is true, deltas may contain <render_searched_image image_id="...">; we strip them and call onImageRef.
 * @param {(...args: any) => void} [onImageRef] - Called with { image_id } when a render tag is found
 * @returns {Promise<{ usage?: object, elapsedMs: number, aborted?: boolean }>}
 */
async function streamGrokResponsesApi({ model, messages, options = {}, onChunk, onUsage, onDone, onImageRef, signal }) {
  const startTime = Date.now();
  let usage = null;
  let doneCalled = false;
  const callOnDone = () => {
    if (!doneCalled) {
      doneCalled = true;
      onDone?.();
    }
  };
  const { headers: authHeaders } = getBaseAndAuth(model);
  const resolvedModel = resolveModelId(model);
  const headers = { 'Content-Type': 'application/json', ...authHeaders };
  const rawMax = options.max_tokens ?? 4096;
  const maxTokens = Math.max(1, Math.min(8192, Number(rawMax) || 4096));
  // Responses API uses "input" (array of message objects, same shape as messages)
  const body = {
    model: resolvedModel,
    input: messages,
    stream: true,
    max_output_tokens: maxTokens,
    temperature: options.temperature ?? 0.7,
    tools: GROK_REALTIME_TOOLS,
    tool_choice: 'auto',
    enable_image_understanding: true,
  };
  applyThinkingToGrokBody(body, { model, options });
  const TAG_PREFIX = '<render_searched_image';
  let imageBuffer = '';
  let debugDeltaLogCount = 0;
  const DEBUG_DELTA_MAX = 3;
  function processDelta(rawDelta) {
    if (typeof rawDelta !== 'string' || !rawDelta) return;
    imageBuffer += rawDelta;
    let emitted = 0;
    let matchCount = 0;
    let match;
    GROK_RENDER_IMAGE_RE.lastIndex = 0;
    while ((match = GROK_RENDER_IMAGE_RE.exec(imageBuffer)) !== null) {
      matchCount++;
      if (match.index > emitted) onChunk?.(imageBuffer.slice(emitted, match.index));
      const size = (match[2] || 'LARGE').toUpperCase();
      onImageRef?.({ image_id: match[1], size: size === 'SMALL' ? 'SMALL' : 'LARGE' });
      emitted = match.index + match[0].length;
    }
    if (matchCount === 0 && /<|render|image_id/i.test(rawDelta) && debugDeltaLogCount < DEBUG_DELTA_MAX) {
      debugDeltaLogCount++;
      console.debug('[Grok image] raw delta (no tag matched):', rawDelta);
    }
    const rest = imageBuffer.slice(emitted);
    const lastOpen = rest.lastIndexOf('<');
    if (lastOpen >= 0 && TAG_PREFIX.startsWith(rest.slice(lastOpen))) {
      if (lastOpen > 0) onChunk?.(rest.slice(0, lastOpen));
      imageBuffer = rest.slice(lastOpen);
    } else {
      if (rest) onChunk?.(rest);
      imageBuffer = '';
    }
  }

  const timeoutCtrl = new AbortController();
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), resolveCloudStreamTimeoutMs(options));
  let effectiveSignal = timeoutCtrl.signal;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      timeoutCtrl.abort();
    } else {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        timeoutCtrl.abort();
      });
    }
  }
  try {
    const res = await fetch(`${XAI_RESPONSES_BASE}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseChatApiError(res.status, text, model));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      let streamEnded = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          callOnDone();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);
          if (payload === '[DONE]') {
            callOnDone();
            streamEnded = true;
            break;
          }
          try {
            const event = JSON.parse(payload);
            const type = event.type ?? event.event;
            // Fallback: chat.completion.chunk (in case xAI sends that for responses)
            const choice = event.choices?.[0];
            if (choice?.delta?.content) {
              processDelta(choice.delta.content);
            }
            // Text deltas (Responses API style) — may contain <render_searched_image image_id="...">
            if (type === 'response.output_text.delta' && event.delta != null) {
              const d = typeof event.delta === 'string' ? event.delta : event.delta.text ?? '';
              processDelta(d);
            } else if (type === 'response.output_text.delta' && event.output_text?.delta != null) {
              const d = event.output_text.delta;
              processDelta(typeof d === 'string' ? d : d.text ?? '');
            } else if (event.output_text?.delta != null) {
              const d = event.output_text.delta;
              processDelta(typeof d === 'string' ? d : d.text ?? '');
            }
            if (event.content_part?.type === 'output_text' && event.content_part.delta != null) {
              processDelta(event.content_part.delta);
            }
            // Usage (any event can carry it)
            if (event.usage) {
              const nextUsage = normalizeChatUsage(event.usage) || event.usage;
              usage = nextUsage;
              onUsage?.(nextUsage);
            }
            // Completion / done
            if (type === 'response.completed' || type === 'response.output_text.done' || type === 'response.done') {
              callOnDone();
              streamEnded = true;
            }
            if (choice?.finish_reason != null) {
              callOnDone();
              streamEnded = true;
            }
            if (streamEnded) break;
          } catch (_) { }
        }
        if (streamEnded) break;
      }
      if (imageBuffer) onChunk?.(imageBuffer);
    } catch (readErr) {
      if (readErr?.name === 'AbortError') {
        return { usage, elapsedMs: Date.now() - startTime, aborted: true };
      }
      throw readErr;
    }
    return { usage, elapsedMs: Date.now() - startTime };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { usage, elapsedMs: Date.now() - startTime, aborted: true };
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export { streamGrokResponsesApi };
