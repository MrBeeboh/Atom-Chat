/**
 * LM Studio API client.
 * OpenAI-compat: base/v1 (e.g. chat/completions)
 * REST (load):   base/api/v1 (e.g. models, models/load)
 *
 * Base URL is configurable via localStorage 'lmStudioBaseUrl' (or Settings). Empty = default.
 * Default: dev uses proxy /api/lmstudio; production uses http://localhost:1234.
 * Compatible with LM Studio 0.4.x: GET /api/v1/models, POST /v1/chat/completions, POST /api/v1/models/load.
 */

const DEFAULT_BASE = typeof import.meta !== 'undefined' && import.meta.env?.DEV ? '/api/lmstudio' : 'http://localhost:1234';

/** Current LM Studio base URL (no trailing slash). Reads from localStorage so UI settings apply immediately. */
function getLmStudioBase() {
  if (typeof localStorage === 'undefined') return DEFAULT_BASE;
  const v = localStorage.getItem('lmStudioBaseUrl');
  if (v != null && String(v).trim() !== '') return String(v).trim().replace(/\/$/, '');
  return DEFAULT_BASE;
}

/**
 * Normalize a single model entry from LM Studio REST or OpenAI-compat response to { id }.
 * REST: { type, key, id?, display_name? }. OpenAI: { id }.
 */
function toModelItem(m) {
  if (!m || typeof m !== 'object') return null;
  const id = m.key ?? m.id ?? m.display_name;
  if (typeof id !== 'string' || !id.trim()) return null;
  return { id: id.trim() };
}

/**
 * Check if LM Studio is reachable (lightweight health check).
 * @returns {Promise<boolean>}
 */
export async function checkLmStudioConnection() {
  const base = getLmStudioBase();
  const tryFetch = async (url) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 3000);
    try {
      const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(to);
    }
  };
  try {
    if (await tryFetch(`${base}/api/v1/models`)) return true;
  } catch (_) {}
  try {
    return await tryFetch(`${base}/v1/models`);
  } catch {
    return false;
  }
}

/**
 * Fetch list of models from LM Studio.
 * Uses LM Studio 0.4.x native GET /api/v1/models (all downloaded LLMs) when available,
 * so all pull-downs show every model. Falls back to OpenAI-compat GET /v1/models (loaded only) for older LM Studio.
 * @returns {Promise<{ id: string }[]>}
 */
export async function getModels() {
  const base = getLmStudioBase();
  const rest = `${base}/api/v1`;
  const openai = `${base}/v1`;
  const res = await fetch(`${rest}/models`);
  if (res.ok) {
    const data = await res.json();
    const raw = data.models ?? (Array.isArray(data) ? data : []);
    if (Array.isArray(raw) && raw.length > 0) {
      const llms = raw
        .filter((m) => m && m.type !== 'embedding')
        .map(toModelItem)
        .filter(Boolean);
      if (llms.length > 0) return llms;
    }
  }
  const fallback = await fetch(`${openai}/models`);
  if (!fallback.ok) throw new Error(`LM Studio models: ${fallback.status}`);
  const data = await fallback.json();
  const list = data.data ?? data;
  const arr = Array.isArray(list) ? list : [];
  return arr.map(toModelItem).filter(Boolean);
}

/**
 * Load a model with the given load config (LM Studio REST API).
 * Applies context_length, eval_batch_size, flash_attention, offload_kv_cache_to_gpu.
 * Model will be unloaded and reloaded with the new config.
 * @param {string} modelId - Model identifier (as in GET /v1/models)
 * @param {Object} loadConfig
 * @param {number} [loadConfig.context_length]
 * @param {number} [loadConfig.eval_batch_size]
 * @param {boolean} [loadConfig.flash_attention]
 * @param {boolean} [loadConfig.offload_kv_cache_to_gpu]
 * @param {string|number} [loadConfig.gpu_offload] - 'max' | 'off' | 0-1 (CLI: --gpu)
 * @param {number} [loadConfig.cpu_threads]
 * @returns {Promise<{ type: string, instance_id: string, load_time_seconds: number, status: string, load_config?: object }>}
 */
export async function loadModel(modelId, loadConfig = {}) {
  const body = { model: modelId };
  if (loadConfig.context_length != null) body.context_length = loadConfig.context_length;
  if (loadConfig.eval_batch_size != null) body.eval_batch_size = loadConfig.eval_batch_size;
  if (loadConfig.flash_attention != null) body.flash_attention = loadConfig.flash_attention;
  if (loadConfig.offload_kv_cache_to_gpu != null) body.offload_kv_cache_to_gpu = loadConfig.offload_kv_cache_to_gpu;
  if (loadConfig.gpu_offload != null) {
    const g = loadConfig.gpu_offload;
    body.gpu = g === 'max' || g === 'off' ? g : Number(g);
  }
  if (loadConfig.cpu_threads != null) body.n_threads = loadConfig.cpu_threads;
  body.echo_load_config = true;

  const base = getLmStudioBase();
  const res = await fetch(`${base}/api/v1/models/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio load: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Stream a chat completion from LM Studio.
 * @param {Object} opts
 * @param {string} opts.model - Model id
 * @param {Array<{ role: string, content: string|Array }>} opts.messages
 * @param {Object} [opts.options] - temperature, max_tokens, ttl, etc.
 * @param {(chunk: string) => void} opts.onChunk
 * @param {(usage: { prompt_tokens?: number, completion_tokens?: number }) => void} [opts.onUsage]
 * @param {() => void} [opts.onDone] - Called when stream ends ([DONE] line or connection closed). Use to clear busy UI immediately.
 * @param {AbortSignal} [opts.signal] - AbortSignal to cancel the stream
 * @returns {Promise<{ usage?: object, elapsedMs: number, aborted?: boolean }>}
 */
export async function streamChatCompletion({ model, messages, options = {}, onChunk, onUsage, onDone, signal }) {
  const startTime = Date.now();
  let usage = null;
  let doneCalled = false;
  const callOnDone = () => {
    if (!doneCalled) {
      doneCalled = true;
      onDone?.();
    }
  };
  const base = getLmStudioBase();
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 4096,
        ...(options.top_p != null && { top_p: options.top_p }),
        ...(options.top_k != null && { top_k: options.top_k }),
        ...(options.repeat_penalty != null && { repeat_penalty: options.repeat_penalty }),
        ...(options.stop?.length && { stop: options.stop }),
        ...(options.ttl != null && Number(options.ttl) > 0 && { ttl: Number(options.ttl) }),
      }),
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio chat: ${res.status} ${text}`);
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
          if (trimmed.startsWith('data: ')) {
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') {
              callOnDone();
              streamEnded = true;
              break;
            }
            try {
              const parsed = JSON.parse(payload);
              const choice = parsed.choices?.[0];
              if (choice?.delta?.content) onChunk(choice.delta.content);
              if (choice?.finish_reason != null) {
                callOnDone();
                streamEnded = true;
              }
              if (parsed.usage) {
                usage = parsed.usage;
                onUsage?.(parsed.usage);
                callOnDone();
                streamEnded = true;
              }
              if (streamEnded) break;
            } catch (_) {}
          }
        }
        if (streamEnded) break;
      }
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
  }
}
