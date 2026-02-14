/**
 * @file api.js
 * @description LM Studio API client: list models, load/unload, chat (streaming and non-streaming).
 *
 * Endpoints: GET /api/v1/models, POST /api/v1/models/load, POST /api/v1/models/unload (per-instance),
 * POST /v1/chat/completions. Bulk eject: unload helper at http://localhost:8766 (POST /unload-all, runs lms unload --all).
 * Base URL: localStorage lmStudioBaseUrl or dev proxy /api/lmstudio or http://localhost:1234.
 */

const DEFAULT_BASE = typeof import.meta !== 'undefined' && import.meta.env?.DEV ? '/api/lmstudio' : 'http://localhost:1234';

/** Current LM Studio base URL (no trailing slash). Reads from localStorage so UI settings apply immediately. */
function getLmStudioBase() {
  if (typeof localStorage === 'undefined') return DEFAULT_BASE;
  const v = localStorage.getItem('lmStudioBaseUrl');
  if (v != null && String(v).trim() !== '') return String(v).trim().replace(/\/$/, '');
  return DEFAULT_BASE;
}

/** Unload helper base URL (e.g. http://localhost:8766). Bulk eject uses POST {url}/unload-all. */
function getUnloadHelperUrl() {
  if (typeof localStorage === 'undefined') return '';
  try {
    const v = localStorage.getItem('lmStudioUnloadHelperUrl');
    return v != null && String(v).trim() !== '' ? String(v).trim().replace(/\/$/, '') : '';
  } catch (_) {
    return '';
  }
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
 * Get model keys that are currently loaded (have at least one instance in memory).
 * Uses GET /api/v1/models and checks loaded_instances. Use to wait until unload is complete.
 * @returns {Promise<string[]>} Model keys (ids) that are loaded
 */
export async function getLoadedModelKeys() {
  const base = getLmStudioBase();
  const res = await fetch(`${base}/api/v1/models`);
  if (!res.ok) return [];
  const data = await res.json();
  const raw = data.models ?? data.data?.models ?? (Array.isArray(data) ? data : []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => {
      const instances = m?.loaded_instances ?? m?.instances ?? m?.loaded;
      return m && Array.isArray(instances) && instances.length > 0;
    })
    .map((m) => m.key ?? m.id ?? '')
    .filter(Boolean);
}

/**
 * Unload one model instance by instance_id (LM Studio REST: POST body is { instance_id }).
 * @param {string} instanceId - From loaded_instances[].id in list response
 * @returns {Promise<{ instance_id?: string }>}
 */
export async function unloadByInstanceId(instanceId) {
  if (!instanceId || typeof instanceId !== 'string') return {};
  const base = getLmStudioBase();
  const res = await fetch(`${base}/api/v1/models/unload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance_id: instanceId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio unload: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Wait until none of the given model IDs are loaded (VRAM freed). Polls getLoadedModelKeys.
 * @param {string[]} modelIds - Model keys to wait until unloaded
 * @param {Object} opts - { pollIntervalMs?: number, timeoutMs?: number }
 * @returns {Promise<void>}
 */
export async function waitUntilUnloaded(modelIds, opts = {}) {
  const { pollIntervalMs = 400, timeoutMs = 25000 } = opts;
  if (!modelIds.length) return;
  const ids = modelIds.map((id) => String(id).trim().toLowerCase());
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const loaded = await getLoadedModelKeys();
    const loadedLower = loaded.map((k) => String(k).trim().toLowerCase());
    const anyStillLoaded = ids.some((id) =>
      loadedLower.some((k) => k === id || k.endsWith('/' + id) || id.endsWith('/' + k) || k.includes(id) || id.includes(k))
    );
    if (!anyStillLoaded) return;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Load a model with the given load config (LM Studio REST API v1).
 * Sends only params LM Studio accepts: context_length, eval_batch_size, flash_attention, offload_kv_cache_to_gpu.
 * GPU, CPU threads, Parallel are stored in our UI but not sent (LM Studio manages them).
 * @param {string} modelId - Model identifier (as in GET /v1/models)
 * @param {Object} loadConfig
 * @param {number} [loadConfig.context_length]
 * @param {number} [loadConfig.eval_batch_size]
 * @param {boolean} [loadConfig.flash_attention]
 * @param {boolean} [loadConfig.offload_kv_cache_to_gpu]
 * @returns {Promise<{ type: string, instance_id: string, load_time_seconds: number, status: string, load_config?: object }>}
 */
export async function loadModel(modelId, loadConfig = {}) {
  const body = { model: modelId };
  if (loadConfig.context_length != null) body.context_length = loadConfig.context_length;
  if (loadConfig.eval_batch_size != null) body.eval_batch_size = loadConfig.eval_batch_size;
  if (loadConfig.flash_attention != null) body.flash_attention = loadConfig.flash_attention;
  if (loadConfig.offload_kv_cache_to_gpu != null) body.offload_kv_cache_to_gpu = loadConfig.offload_kv_cache_to_gpu;
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
 * Get loaded instance IDs for a single model key (from GET /api/v1/models: model.key + loaded_instances[].id).
 * @param {string} modelKey - Model key to match (m.key ?? m.id)
 * @returns {Promise<string[]>}
 */
export async function getLoadedInstanceIdsForModel(modelKey) {
  if (!modelKey || typeof modelKey !== 'string') return [];
  const base = getLmStudioBase();
  const res = await fetch(`${base}/api/v1/models`);
  if (!res.ok) return [];
  const data = await res.json();
  const raw = data.models ?? data.data?.models ?? (Array.isArray(data) ? data : []);
  const key = String(modelKey).trim().toLowerCase();
  const ids = [];
  for (const m of raw) {
    const modelKeyCur = (m?.key ?? m?.id ?? '').toString().trim().toLowerCase();
    if (!modelKeyCur || modelKeyCur !== key && !modelKeyCur.endsWith('/' + key) && !key.endsWith('/' + modelKeyCur))
      continue;
    const instances = m?.loaded_instances ?? m?.instances;
    if (Array.isArray(instances)) for (const inst of instances) if (inst?.id != null) ids.push(String(inst.id));
  }
  return ids;
}

/**
 * Unload a model from memory by model key. Resolves to instance IDs via list API and unloads each.
 * @param {string} modelId - Model key (e.g. from load or list)
 * @returns {Promise<void>}
 */
export async function unloadModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return;
  const instanceIds = await getLoadedInstanceIdsForModel(modelId);
  await Promise.allSettled(instanceIds.map((id) => unloadByInstanceId(id).catch(() => {})));
}

const DEFAULT_UNLOAD_HELPER_URL = 'http://localhost:8766';

/**
 * Unload every currently loaded model instance (e.g. before Arena run to free VRAM).
 * Calls the helper at helperUrlOrOverride, or from localStorage, or default http://localhost:8766.
 * If the helper is not running, returns { ok: false } and does not throw — so Arena run is never blocked.
 * @param {string} [helperUrlOrOverride] - Optional; if set, use this; else localStorage; else default.
 * @returns {Promise<{ ok: boolean }>} - ok true if eject succeeded, false if helper unreachable or error.
 */
export async function unloadAllLoadedModels(helperUrlOrOverride) {
  const fromOverride =
    typeof helperUrlOrOverride === 'string' && helperUrlOrOverride.trim()
      ? helperUrlOrOverride.trim().replace(/\/$/, '')
      : '';
  const helperUrl = fromOverride || getUnloadHelperUrl() || DEFAULT_UNLOAD_HELPER_URL;

  try {
    const res = await fetch(`${helperUrl}/unload-all`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) return { ok: true };
    return { ok: false };
  } catch (_) {
    return { ok: false };
  }
}

/**
 * Unload ALL currently loaded model instances using the native LM Studio API.
 * Does NOT require any helper server. Finds every loaded instance via
 * GET /api/v1/models and calls POST /api/v1/models/unload for each.
 * @returns {Promise<{ ok: boolean, unloaded: number }>}
 */
export async function unloadAllModelsNative() {
  try {
    const base = getLmStudioBase();
    const res = await fetch(`${base}/api/v1/models`);
    if (!res.ok) return { ok: false, unloaded: 0 };
    const data = await res.json();
    const raw = data.models ?? data.data?.models ?? (Array.isArray(data) ? data : []);
    if (!Array.isArray(raw)) return { ok: false, unloaded: 0 };
    const instanceIds = [];
    for (const m of raw) {
      const instances = m?.loaded_instances ?? m?.instances;
      if (Array.isArray(instances)) {
        for (const inst of instances) {
          if (inst?.id != null) instanceIds.push(String(inst.id));
        }
      }
    }
    if (instanceIds.length === 0) return { ok: true, unloaded: 0 };
    await Promise.allSettled(instanceIds.map((id) => unloadByInstanceId(id).catch(() => {})));
    return { ok: true, unloaded: instanceIds.length };
  } catch (_) {
    return { ok: false, unloaded: 0 };
  }
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
  const base = getLmStudioBase();
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 1024,
      ...(options.top_p != null && { top_p: options.top_p }),
      ...(options.top_k != null && { top_k: options.top_k }),
      ...(options.repeat_penalty != null && { repeat_penalty: options.repeat_penalty }),
      ...(options.presence_penalty != null && { presence_penalty: options.presence_penalty }),
      ...(options.frequency_penalty != null && { frequency_penalty: options.frequency_penalty }),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LM Studio chat: ${res.status} ${text}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  return { content: String(content).trim(), usage: data.usage };
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
        stream_options: { include_usage: true },
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens ?? 4096,
        ...(options.top_p != null && { top_p: options.top_p }),
        ...(options.top_k != null && { top_k: options.top_k }),
        ...(options.repeat_penalty != null && { repeat_penalty: options.repeat_penalty }),
        ...(options.presence_penalty != null && { presence_penalty: options.presence_penalty }),
        ...(options.frequency_penalty != null && { frequency_penalty: options.frequency_penalty }),
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

/** Default URL for hardware bridge (scripts/hardware_server.py). Override with localStorage 'hardwareMetricsUrl'. */
const DEFAULT_HARDWARE_URL = 'http://localhost:5000';

/**
 * Fetch hardware metrics from Python bridge (CPU, RAM, GPU util, VRAM). For floating metrics panel.
 * @returns {Promise<{ cpu_percent: number, ram_used_gb: number, ram_total_gb: number, gpu_util: number, vram_used_gb: number, vram_total_gb: number }|null>}
 */
export async function fetchHardwareMetrics() {
  let base = DEFAULT_HARDWARE_URL;
  if (typeof localStorage !== 'undefined') {
    const custom = localStorage.getItem('hardwareMetricsUrl');
    if (custom != null && String(custom).trim() !== '') base = String(custom).trim().replace(/\/$/, '');
  }
  const url = `${base}/metrics`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(t);
    return null;
  }
}
