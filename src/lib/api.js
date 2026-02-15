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
 * Cloud API providers (OpenAI-compatible). When API key is set in localStorage, their models are included in getModels().
 * Model id format: "provider:modelId" so we know which base URL and auth to use.
 */
const CLOUD_PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    /** No /v1 in base; we append /v1/chat/completions */
    models: ['deepseek-chat', 'deepseek-reasoner'],
    getKey: () => (typeof localStorage !== 'undefined' ? localStorage.getItem('deepSeekApiKey') : null) ?? '',
  },
  grok: {
    name: 'Grok',
    baseUrl: 'https://api.x.ai/v1',
    /** xAI base already has /v1; chat path is /chat/completions */
    models: ['grok-3-mini', 'grok-3', 'grok-4', 'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning', 'grok-4-fast-reasoning', 'grok-4-latest'],
    getKey: () => (typeof localStorage !== 'undefined' ? localStorage.getItem('grokApiKey') : null) ?? '',
  },
};

/** Short descriptive tag for cloud models (shown next to name in selector). */
const MODEL_TYPE_TAGS = {
  'grok-3-mini': 'Mini Chat',
  'grok-3': 'General Chat',
  'grok-4': 'Reasoning',
  'grok-4-1-fast-reasoning': 'Fast Reasoning',
  'grok-4-1-fast-non-reasoning': 'Fast Chat',
  'grok-4-fast-reasoning': 'Fast Reasoning',
  'grok-4-latest': 'Reasoning (Latest)',
  'deepseek-chat': 'Chat',
  'deepseek-reasoner': 'Reasoning',
};

/** Get short model type tag (e.g. "Reasoning", "Fast Chat"). Returns null if no tag. */
export function getModelTypeTag(id) {
  if (!id || typeof id !== 'string') return null;
  const colon = id.indexOf(':');
  const modelPart = colon === -1 ? id : id.slice(colon + 1);
  return MODEL_TYPE_TAGS[modelPart] ?? null;
}

/** Human-readable label for the model dropdown. "deepseek:deepseek-chat" → "DeepSeek: deepseek-chat". */
export function modelDisplayName(id) {
  if (!id || typeof id !== 'string') return id;
  const i = id.indexOf(':');
  if (i === -1) return id;
  const provider = id.slice(0, i);
  const label = CLOUD_PROVIDERS[provider]?.name ?? provider;
  return `${label}: ${id.slice(i + 1)}`;
}

/** Get base URL and headers for a given model id. Local models use LM Studio; "provider:modelId" use cloud. */
function getBaseAndAuth(modelId) {
  if (!modelId || typeof modelId !== 'string') return { base: getLmStudioBase(), headers: {} };
  const colon = modelId.indexOf(':');
  if (colon === -1) return { base: getLmStudioBase(), headers: {} };
  const providerId = modelId.slice(0, colon);
  const provider = CLOUD_PROVIDERS[providerId];
  if (!provider) return { base: getLmStudioBase(), headers: {} };
  const key = provider.getKey()?.trim();
  if (!key) return { base: getLmStudioBase(), headers: {} };
  const headers = { Authorization: `Bearer ${key}` };
  return { base: provider.baseUrl.replace(/\/$/, ''), headers };
}

/** Resolve model id for the API request (cloud: use part after colon; local: use as-is). */
function resolveModelId(modelId) {
  if (!modelId || typeof modelId !== 'string') return modelId;
  const colon = modelId.indexOf(':');
  return colon === -1 ? modelId : modelId.slice(colon + 1);
}

/** True when model id is Grok (grok:grok-4, etc.). Used to route to Responses API with tools for real-time search. */
export function isGrokModel(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('grok:');
}

/** True when model id is DeepSeek (deepseek:deepseek-chat, etc.). Used to route image generation. */
export function isDeepSeekModel(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('deepseek:');
}

/** DeepSeek does NOT have a native image generation API (they only analyze images). Endpoint below does not exist; kept for possible future proxy (e.g. Together AI). */
const DEEPSEEK_IMAGES_GENERATIONS_URL = 'https://api.deepseek.com/v1/images/generations';

/** xAI Responses API base (same host as chat; path is /responses). */
const XAI_RESPONSES_BASE = 'https://api.x.ai/v1';

/** xAI Image generations endpoint (separate from chat; creates new images from prompt). */
const XAI_IMAGES_GENERATIONS_URL = 'https://api.x.ai/v1/images/generations';

/** Built-in tools for real-time web, X, and image search (server-side execution by xAI). */
/** Grok Responses API: only web_search and x_search are supported. search_images is not a valid tool type. */
const GROK_REALTIME_TOOLS = [
  { type: 'web_search' },
  { type: 'x_search' },
];

/**
 * Parse Chat API error response body and return a user-facing message.
 * Handles OpenAI-style { error: { message, type, code } }, { message }, and plain text.
 * Maps status + type to actionable guidance (e.g. 401 → check API key in Settings).
 * @param {number} status - HTTP status code
 * @param {string} bodyText - Raw response body
 * @param {string} [modelId] - Requested model id (e.g. grok:grok-4) to tailor cloud vs local hints
 * @returns {string} Message suitable for chatError / user display
 */
function parseChatApiError(status, bodyText, modelId) {
  let apiMessage = '';
  let errorType = '';
  let code = '';
  const isCloud = modelId && String(modelId).includes(':');
  const cloudHint = isCloud
    ? ' Check Settings → Cloud APIs (DeepSeek & Grok): confirm the key is correct, has no extra spaces, and is valid for the selected provider.'
    : '';

  if (bodyText && bodyText.trim()) {
    try {
      const json = JSON.parse(bodyText);
      const err = json.error ?? json;
      if (err && typeof err === 'object') {
        apiMessage = err.message ?? err.msg ?? '';
        errorType = err.type ?? err.error ?? '';
        code = err.code ?? '';
      } else if (typeof err === 'string') {
        apiMessage = err;
      } else if (typeof json.message === 'string') {
        apiMessage = json.message;
      }
    } catch (_) {
      apiMessage = bodyText.trim().slice(0, 200);
    }
  }

  apiMessage = typeof apiMessage === 'string' ? apiMessage.trim() : '';

  switch (status) {
    case 401:
      if (errorType === 'authentication_error' || code === 'invalid_request_error' || code === 'invalid_api_key' || /invalid|auth|key|unauthorized/i.test(apiMessage)) {
        return `Invalid API key.${cloudHint}`;
      }
      return apiMessage || `Authentication failed.${cloudHint}`;
    case 403:
      return apiMessage || `Access forbidden. Your key may not have permission for this model.${cloudHint}`;
    case 429:
      if (code === 'rate_limit_exceeded') return 'Too many requests. Please wait a moment and try again.';
      return apiMessage || 'Rate limit exceeded. Try again in a moment.';
    case 500:
    case 502:
    case 503:
      return apiMessage || 'The API server had an error. Try again later.';
    case 400:
      if (code === 'model_not_found') return apiMessage || 'Model not found. Check the model name in Settings or try a different model.';
      if (code === 'context_length_exceeded') return apiMessage || 'Message or context too long. Try a shorter conversation or message.';
      return apiMessage || 'Bad request. Check your request or try a different model.';
    default:
      return apiMessage || `Request failed (${status}). Try again or check Settings.`;
  }
}

/** Return cloud provider models when API key is set. Ids are "provider:modelId". */
function getCloudModels() {
  const out = [];
  for (const [providerId, p] of Object.entries(CLOUD_PROVIDERS)) {
    if (!p.getKey()?.trim()) continue;
    for (const modelId of p.models) {
      out.push({ id: `${providerId}:${modelId}` });
    }
  }
  return out;
}

/** Timeout for LM Studio model list fetch so we don't hang when server is down; then cloud-only list can still load. */
const LOCAL_MODELS_TIMEOUT_MS = 10000;

/** Timeout for cloud (Grok, DeepSeek) API requests. 120s per DeepSeek guidance for reasoning models. */
const CLOUD_REQUEST_TIMEOUT_MS = 120000;

/**
 * Fetch list of models from LM Studio (local). Throws if unreachable or timeout.
 * @returns {Promise<{ id: string }[]>}
 */
async function getLocalModels() {
  const base = getLmStudioBase();
  const rest = `${base}/api/v1`;
  const openai = `${base}/v1`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), LOCAL_MODELS_TIMEOUT_MS);
  try {
    const res = await fetch(`${rest}/models`, { signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json();
      const raw = data.models ?? (Array.isArray(data) ? data : []);
      if (Array.isArray(raw) && raw.length > 0) {
        const llms = raw
          .filter((m) => m && m.type !== 'embedding')
          .map(toModelItem)
          .filter(Boolean);
        if (llms.length > 0) {
          clearTimeout(to);
          return llms;
        }
      }
    }
    const fallback = await fetch(`${openai}/models`, { signal: ctrl.signal });
    if (!fallback.ok) throw new Error(`LM Studio models: ${fallback.status}`);
    const data = await fallback.json();
    const list = data.data ?? data;
    const arr = Array.isArray(list) ? list : [];
    return arr.map(toModelItem).filter(Boolean);
  } finally {
    clearTimeout(to);
  }
}

/**
 * Fetch list of models: LM Studio (local) + DeepSeek and Grok when API keys are set.
 * If LM Studio is unreachable, returns only cloud models so you can still use DeepSeek/Grok.
 * @returns {Promise<{ id: string }[]>}
 */
export async function getModels() {
  let local = [];
  try {
    local = await getLocalModels();
  } catch (_) {
    // LM Studio unreachable; still return cloud models if configured
  }
  const cloud = getCloudModels();
  return [...local, ...cloud];
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
/**
 * Parse content from xAI Responses API non-stream response (output array or choices).
 */
function parseGrokResponseOutput(data) {
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
export async function requestGrokImageGeneration({ prompt, n = 1, aspect_ratio = '1:1', resolution = '1k', response_format = 'url' }) {
  const { headers: authHeaders } = getBaseAndAuth('grok:grok-4');
  if (!authHeaders?.Authorization) throw new Error('Grok API key required. Add it in Settings → Cloud APIs.');
  const body = {
    model: 'grok-imagine-image',
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
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404 || /model.*not.*found|invalid.*model/i.test(text)) {
        const fallbackCtrl = new AbortController();
        const fallbackTo = setTimeout(() => fallbackCtrl.abort(), 60000);
        try {
          const fallback = await fetch(XAI_IMAGES_GENERATIONS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ ...body, model: 'grok-2-image' }),
            signal: fallbackCtrl.signal,
          });
          clearTimeout(fallbackTo);
          if (fallback.ok) return fallback.json();
        } catch (_) {
          clearTimeout(fallbackTo);
        }
      }
      throw new Error(parseChatApiError(res.status, text, 'grok:grok-imagine-image'));
    }
    return res.json();
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/**
 * DeepSeek image generation. NOTE: DeepSeek has no native /v1/images/generations; this would 404. Kept for future use if we proxy to Together AI etc.
 * @param {{ prompt: string, n?: number, size?: string, quality?: string, response_format?: string }} opts
 * @returns {Promise<{ data: Array<{ url?: string, b64_json?: string }> }>}
 */
export async function requestDeepSeekImageGeneration({
  prompt,
  n = 1,
  size = '1024x1024',
  quality = 'standard',
  response_format = 'url',
}) {
  const { headers: authHeaders } = getBaseAndAuth('deepseek:deepseek-chat');
  if (!authHeaders?.Authorization) throw new Error('DeepSeek API key required. Add it in Settings → Cloud APIs.');
  const body = {
    model: 'deepseek-image',
    prompt: String(prompt).trim(),
    n: Math.max(1, Math.min(10, Number(n) || 1)),
    size: size || '1024x1024',
    quality: quality || 'standard',
    response_format,
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(DEEPSEEK_IMAGES_GENERATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseChatApiError(res.status, text, 'deepseek:deepseek-image'));
    }
    return res.json();
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/** Together.xyz image generation: separate endpoint for DeepSeek path (DeepSeek has no native image API). Do not use for Grok. */
const TOGETHER_IMAGES_GENERATIONS_URL = 'https://api.together.xyz/v1/images/generations';

/**
 * Generate image via Together AI (used when DeepSeek is selected; different endpoint from DeepSeek chat).
 * Request format: model, prompt, width, height, steps, n, response_format.
 * @param {{ prompt: string, apiKey: string, model?: string, width?: number, height?: number, steps?: number, n?: number }} opts
 * @returns {Promise<{ data: Array<{ url?: string }> }>}
 */
export async function requestTogetherImageGeneration({
  prompt,
  apiKey,
  model = 'black-forest-labs/FLUX.1-schnell',
  width = 1024,
  height = 1024,
  steps = 4,
  n = 1,
}) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('Together API key required for image generation when using DeepSeek. Add it in Settings or .env.');
  const body = {
    model,
    prompt: String(prompt).trim(),
    width: Number(width) || 1024,
    height: Number(height) || 1024,
    steps: Math.max(1, Math.min(50, Number(steps) || 4)),
    n: Math.max(1, Math.min(4, Number(n) || 1)),
    response_format: 'url',
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(TOGETHER_IMAGES_GENERATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseChatApiError(res.status, text, 'together:image'));
    }
    return res.json();
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/** DeepInfra inference base (image + video). Per official docs: https://api.deepinfra.com/v1/inference/{model_id} */
const DEEPINFRA_INFERENCE_BASE = 'https://api.deepinfra.com/v1/inference';

/**
 * Text-to-image via DeepInfra. Synchronous; returns base64 in response.images[0].
 * @param {{ apiKey: string, modelId: string, prompt: string, num_images?: number, num_inference_steps?: number, guidance_scale?: number, width?: number, height?: number, negative_prompt?: string }} opts
 * @returns {Promise<{ data: Array<{ url: string }> }>} data[].url are data URLs (data:image/png;base64,...) for display
 */
export async function requestDeepInfraImageGeneration({
  apiKey,
  modelId,
  prompt,
  num_images = 1,
  num_inference_steps = 30,
  guidance_scale = 7.5,
  width = 1024,
  height = 1024,
  negative_prompt,
}) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('DeepInfra API key required. Add it in Settings → Cloud APIs.');
  const body = {
    prompt: String(prompt).trim(),
    num_images: Math.max(1, Math.min(4, Number(num_images) || 1)),
    num_inference_steps: Math.max(1, Math.min(50, Number(num_inference_steps) || 30)),
    guidance_scale: Number(guidance_scale) || 7.5,
    width: Math.max(128, Math.min(1024, Number(width) || 1024)),
    height: Math.max(128, Math.min(1024, Number(height) || 1024)),
  };
  if (negative_prompt != null && String(negative_prompt).trim() !== '') body.negative_prompt = String(negative_prompt).trim();
  const url = `${DEEPINFRA_INFERENCE_BASE}/${encodeURIComponent(modelId)}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.detail?.error || data?.detail || JSON.stringify(data) || res.statusText;
      throw new Error(parseChatApiError(res.status, msg, 'deepinfra:image'));
    }
    const rawImages = data?.images ?? data?.result?.images ?? [];
    const images = Array.isArray(rawImages) ? rawImages : [];
    if (images.length === 0) throw new Error('DeepInfra image response had no images.');
    const urls = images.map((item) => {
      if (typeof item === 'string') {
        if (item.startsWith('data:') || item.startsWith('http://') || item.startsWith('https://')) return item;
        return `data:image/png;base64,${item}`;
      }
      if (item && typeof item === 'object' && typeof item.url === 'string') return item.url;
      return null;
    }).filter(Boolean);
    if (urls.length === 0) throw new Error('DeepInfra image response had no images.');
    return { data: urls.map((url) => ({ url })) };
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/**
 * Text-to-video via DeepInfra. Synchronous; returns relative path in response.video_url or response.videos. Full URL = base + path.
 * CRITICAL (DeepInfra docs): Video models accept ONLY the "prompt" field. ANY other field (width, height, duration, negative_prompt, etc.) causes "signal aborted without reason". Do not add or spread any options here.
 * @param {{ apiKey: string, modelId: string, prompt: string }} opts
 * @returns {Promise<{ videoUrl: string }>}
 */
export async function requestDeepInfraVideoGeneration({ apiKey, modelId, prompt }) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('DeepInfra API key required. Add it in Settings → Cloud APIs.');
  const promptOnly = String(prompt ?? '').trim();
  const url = `${DEEPINFRA_INFERENCE_BASE}/${modelId}`;
  const VIDEO_TIMEOUT_MS = 1200000; // 20 minutes — DeepInfra video takes 5–10+ min; webhooks need a backend so we wait
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), VIDEO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt: promptOnly }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.detail?.error || data?.detail || JSON.stringify(data) || res.statusText;
      throw new Error(parseChatApiError(res.status, msg, 'deepinfra:video'));
    }
    // Different models return video in different fields. Try all known shapes.
    const candidates = [
      data?.video_url,
      data?.videos,
      data?.video,
      data?.output,
      data?.url,
      data?.result?.video_url,
      data?.result?.videos,
      data?.result?.video,
      data?.result?.output,
      data?.result?.url,
    ];
    let pathStr = null;
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) { pathStr = c.trim(); break; }
      if (Array.isArray(c) && c.length > 0) {
        const first = typeof c[0] === 'string' ? c[0] : c[0]?.url ?? c[0]?.video_url ?? null;
        if (typeof first === 'string' && first.trim()) { pathStr = first.trim(); break; }
      }
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const inner = c.url ?? c.video_url ?? c.video ?? null;
        if (typeof inner === 'string' && inner.trim()) { pathStr = inner.trim(); break; }
      }
    }
    if (!pathStr) throw new Error(`DeepInfra video: unexpected response shape. Keys: ${Object.keys(data || {}).join(', ')}`);
    const fullVideoUrl =
      pathStr.startsWith('data:') || pathStr.startsWith('http://') || pathStr.startsWith('https://')
        ? pathStr
        : `https://api.deepinfra.com${pathStr.startsWith('/') ? pathStr : `/${pathStr}`}`;
    return { videoUrl: fullVideoUrl };
  } catch (err) {
    clearTimeout(to);
    if (err?.name === 'AbortError') {
      throw new Error(`Video generation timed out after ${VIDEO_TIMEOUT_MS / 60000} minutes. Try again or use a shorter prompt.`);
    }
    throw err;
  }
}

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
  const resolvedModel = resolveModelId(model);
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json', ...authHeaders };
  const isCloud = model && String(model).includes(':');
  const rawMax = options.max_tokens ?? 1024;
  const maxTokens = isCloud ? Math.max(1, Math.min(8192, Number(rawMax) || 1024)) : rawMax;
  const body = {
    model: resolvedModel,
    messages,
    stream: false,
    temperature: options.temperature ?? 0.3,
    max_tokens: maxTokens,
    ...(options.top_p != null && { top_p: options.top_p }),
    ...(options.top_k != null && { top_k: options.top_k }),
    ...(!isCloud && options.repeat_penalty != null && { repeat_penalty: options.repeat_penalty }),
    ...(!isCloud && options.presence_penalty != null && { presence_penalty: options.presence_penalty }),
    ...(!isCloud && options.frequency_penalty != null && { frequency_penalty: options.frequency_penalty }),
  };
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
      const content = data.choices?.[0]?.message?.content ?? '';
      return { content: String(content).trim(), usage: data.usage };
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
  const content = data.choices?.[0]?.message?.content ?? '';
  return { content: String(content).trim(), usage: data.usage };
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
  const timeoutId = setTimeout(() => timeoutCtrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
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
              usage = event.usage;
              onUsage?.(event.usage);
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
          } catch (_) {}
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

/**
 * Stream a chat completion from LM Studio.
 * @param {Object} opts
 * @param {string} opts.model - Model id
 * @param {Array<{ role: string, content: string|Array }>} opts.messages
 * @param {Object} [opts.options] - temperature, max_tokens, ttl, etc.
 * @param {(chunk: string) => void} opts.onChunk
 * @param {(usage: { prompt_tokens?: number, completion_tokens?: number }) => void} [opts.onUsage]
 * @param {() => void} [opts.onDone] - Called when stream ends ([DONE] line or connection closed). Use to clear busy UI immediately.
 * @param {(ref: { image_id: string }) => void} [opts.onImageRef] - (Grok only) Called when a <render_searched_image image_id="..."> is found in the stream.
 * @param {AbortSignal} [opts.signal] - AbortSignal to cancel the stream
 * @returns {Promise<{ usage?: object, elapsedMs: number, aborted?: boolean }>}
 */
export async function streamChatCompletion({ model, messages, options = {}, onChunk, onUsage, onDone, onImageRef, signal }) {
  if (isGrokModel(model)) {
    return streamGrokResponsesApi({ model, messages, options, onChunk, onUsage, onDone, onImageRef, signal });
  }
  const startTime = Date.now();
  let usage = null;
  let doneCalled = false;
  const callOnDone = () => {
    if (!doneCalled) {
      doneCalled = true;
      onDone?.();
    }
  };
  const { base, headers: authHeaders } = getBaseAndAuth(model);
  const resolvedModel = resolveModelId(model);
  const streamUrl = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json', ...authHeaders };
  const isCloud = model && String(model).includes(':');
  const rawMax = options.max_tokens ?? 4096;
  const maxTokens = isCloud ? Math.max(1, Math.min(8192, Number(rawMax) || 4096)) : rawMax;
  const streamBody = {
    model: resolvedModel,
    messages,
    stream: true,
    ...(!isCloud && { stream_options: { include_usage: true } }),
    temperature: options.temperature ?? 0.7,
    max_tokens: maxTokens,
    ...(options.top_p != null && { top_p: options.top_p }),
    ...(options.top_k != null && { top_k: options.top_k }),
    ...(!isCloud && options.repeat_penalty != null && { repeat_penalty: options.repeat_penalty }),
    ...(!isCloud && options.presence_penalty != null && { presence_penalty: options.presence_penalty }),
    ...(!isCloud && options.frequency_penalty != null && { frequency_penalty: options.frequency_penalty }),
    ...(options.stop?.length && { stop: options.stop }),
    ...(!isCloud && options.ttl != null && Number(options.ttl) > 0 && { ttl: Number(options.ttl) }),
  };
  let effectiveSignal = signal;
  let timeoutId = null;
  if (isCloud) {
    const timeoutCtrl = new AbortController();
    timeoutId = setTimeout(() => timeoutCtrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
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
    effectiveSignal = timeoutCtrl.signal;
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
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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
