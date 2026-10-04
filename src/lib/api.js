/**
 * @file api.js
 * @description Inference API client: list models, load/unload, chat (streaming and non-streaming).
 *
 * Backends: LM Studio (GET /api/v1/models, POST load/unload), llama.cpp router (GET /models, POST /models/load|unload),
 * legacy single-model llama-server (-m), and cloud providers (OpenAI-compatible).
 *
 * Bulk eject helper: POST http://localhost:8766/unload-all (optional).
 * Base URL: localStorage lmStudioBaseUrl or dev proxy /api/llama or http://localhost:8080.
 */

import {
  CLOUD_PROVIDERS,
  fetchCloudModels,
  getModelTypeTag,
  invalidateCloudModelCache,
} from '$lib/cloudCatalog.js';
import { mergeToolCallDeltas, finalizeToolCalls } from '$lib/desktopHost.js';
import { recordDeepSeekCacheUsage } from '$lib/deepSeekCache.js';
import { applyThinkingToChatBody, applyThinkingToGrokBody } from '$lib/thinkingControls.js';
import { endpointCapsFromRow } from '$lib/modelCapabilities.js';
import { normalizeChatUsage } from '$lib/modelPricing.js';

export { CLOUD_PROVIDERS, getModelTypeTag, invalidateCloudModelCache };

// Default backend is the llama.cpp router on port 8080 (Flash-Next is proxied there).
// LM Studio still works if you change the URL in Settings → Connection.
const DEFAULT_BASE = typeof import.meta !== 'undefined' && import.meta.env?.DEV ? '/api/llama' : 'http://localhost:8080';

function viteEnvStr(key) {
  const map = {
    VITE_LM_STUDIO_BASE_URL: import.meta.env.VITE_LM_STUDIO_BASE_URL,
    VITE_DEEPSEEK_API_KEY: import.meta.env.VITE_DEEPSEEK_API_KEY,
    VITE_GROK_API_KEY: import.meta.env.VITE_GROK_API_KEY,
    VITE_CEREBRAS_API_KEY: import.meta.env.VITE_CEREBRAS_API_KEY,
    VITE_DEEPINFRA_API_KEY: import.meta.env.VITE_DEEPINFRA_API_KEY,
    VITE_NOUS_API_KEY: import.meta.env.VITE_NOUS_API_KEY,
  };
  const v = map[key];
  return typeof v === 'string' ? v.trim() : '';
}

function localStorageOrVite(storageKey, viteName) {
  const fromEnv = viteEnvStr(viteName);
  if (fromEnv) return fromEnv;
  if (typeof localStorage !== 'undefined') {
    return (localStorage.getItem(storageKey) ?? '').trim();
  }
  return '';
}

let lastResolvedLmBase = '';
/** True when GET /api/v1/models succeeds (LM Studio–style management). llama-server returns 404. */
let lmsRestModelsListSupported = null;
/** True when GET /models (llama.cpp router) succeeds. False = probed and not router. Null = never successfully probed. */
let llamaRouterModelsSupported = null;
/** Ids from the last successful local model list fetch (used when the server runs a single loaded model). */
let lastLocalModelIds = [];

/** Model id the already-loaded Flash-Next server advertises. */
export const QWEN38_FLASH_NEXT_MODEL_ID = 'Qwen3.8-Flash-Next';
/** Direct llama-server for Flash-Next. Do not send this id to the :8080 router. */
const FLASH_NEXT_CHAT_BASE = 'http://127.0.0.1:8081';
const FLASH_NEXT_START_HINT = 'llama-flash-next restart';

function firstTokenTimeoutError(model, { multimodal = false, waitMs = 30000 } = {}) {
  const waitLabel = `${Math.round(waitMs / 1000)}s`;
  const err = new Error(
    isQwen38FlashNextSelection(model)
      ? `Qwen3.8-Flash-Next did not emit a token in ${waitLabel}. GPU job is likely stuck — run: ${FLASH_NEXT_START_HINT}`
      : 'No first token from the local server. It may be hung — retry or restart llama-server.',
  );
  err.name = 'FirstTokenTimeout';
  return err;
}

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

/** Decode counter lives under next_token[] on current llama.cpp slots. */
function slotDecodedCount(slot) {
  if (!slot || typeof slot !== 'object') return 0;
  const top = Number(slot.n_decoded);
  if (Number.isFinite(top) && top > 0) return top;
  const nt = Array.isArray(slot.next_token) ? slot.next_token[0] : slot.next_token;
  const nested = Number(nt?.n_decoded);
  return Number.isFinite(nested) && nested > 0 ? nested : 0;
}

/**
 * Flash-Next progress probe: prompt eval or decode moving means the GPU is alive
 * even if the browser has not parsed a content delta yet.
 */
async function flashNextSlotIsAlive() {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/slots`, { signal: ctrl.signal });
      if (!res.ok) return false;
      const rows = await res.json();
      const slot = Array.isArray(rows) ? rows[0] : null;
      if (!slot?.is_processing) return false;
      const processed = Number(slot.n_prompt_tokens_processed) || 0;
      return processed > 0 || slotDecodedCount(slot) > 0;
    } finally {
      clearTimeout(to);
    }
  } catch {
    return false;
  }
}

/**
 * True for the proxy alias or a local-disk shard whose filename is the Flash-Next GGUF.
 * Cloud ids (provider:model) are never this.
 * @param {string} modelId
 */
export function isQwen38FlashNextSelection(modelId) {
  if (!modelId || typeof modelId !== 'string' || modelId.includes(':')) return false;
  const leaf = modelId.replace(/\\/g, '/').split('/').pop() || '';
  const name = leaf.trim().toLowerCase();
  if (name === 'qwen3.8-flash-next') return true;
  return name.startsWith('qwen3.8-flash-next') && name.endsWith('.gguf');
}

/**
 * The :8080 proxy row for Flash-Next has no architecture/capabilities.
 * :8081 /props.modalities is the live mmproj flag (vision on/off).
 * @param {{ id: string, caps?: object }[]} items
 */
async function attachFlashNextLiveCaps(items) {
  if (!Array.isArray(items) || !items.some((m) => isQwen38FlashNextSelection(m?.id))) return items;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/props`, { signal: ctrl.signal });
      if (!res.ok) return items;
      const caps = endpointCapsFromRow(await res.json());
      if (!caps) return items;
      return items.map((m) =>
        isQwen38FlashNextSelection(m?.id) ? { ...m, caps: { ...(m.caps || {}), ...caps } } : m,
      );
    } finally {
      clearTimeout(to);
    }
  } catch {
    return items;
  }
}

/** Live mmproj flag from the Flash-Next server (not the model-id heuristic). */
export async function flashNextHasVision() {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/props`, { signal: ctrl.signal });
      if (!res.ok) return false;
      return endpointCapsFromRow(await res.json())?.vision === true;
    } finally {
      clearTimeout(to);
    }
  } catch {
    return false;
  }
}

/**
 * Request-body model field. Disk picks use the GGUF filename; the proxy only
 * forwards the alias and would otherwise ask the router to load the shard.
 * @param {string} selectedId
 * @param {string} resolvedId
 */
export function localChatModelIdForRequest(selectedId, resolvedId) {
  if (isQwen38FlashNextSelection(selectedId) || isQwen38FlashNextSelection(resolvedId)) {
    return QWEN38_FLASH_NEXT_MODEL_ID;
  }
  return resolvedId;
}

/** 0 / NaN / -1 must not become unlimited n_predict on llama.cpp. */
export function clampChatMaxTokens(raw, { cloud = false } = {}) {
  const n = Number(raw);
  const fallback = 4096;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const cap = cloud ? 8192 : 100000;
  return Math.min(cap, Math.floor(n));
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Flash-Next after an Intel GPU reset still answers /health while the slot
 * sits at 0 tokens processed. Catch that before Arena waits 2 minutes on
 * "Reasoning…".
 */
export async function assertFlashNextCanChat() {
  const healthCtrl = new AbortController();
  const healthTo = setTimeout(() => healthCtrl.abort(), 2500);
  try {
    const health = await fetch(`${FLASH_NEXT_CHAT_BASE}/health`, { signal: healthCtrl.signal });
    if (!health.ok) {
      throw new Error(`Qwen3.8-Flash-Next is not running (health ${health.status}). Start it with: llama-flash-next start`);
    }
  } catch (err) {
    if (err?.message && /Qwen3\.8-Flash-Next is not running/.test(err.message)) throw err;
    return;
  } finally {
    clearTimeout(healthTo);
  }

  let first;
  try {
    const slotsCtrl = new AbortController();
    const slotsTo = setTimeout(() => slotsCtrl.abort(), 2500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/slots`, { signal: slotsCtrl.signal });
      first = res.ok ? await res.json() : null;
    } finally {
      clearTimeout(slotsTo);
    }
  } catch {
    return;
  }
  const slot = Array.isArray(first) ? first[0] : null;
  if (!slot || !slot.is_processing) return;
  const processed = Number(slot.n_prompt_tokens_processed) || 0;
  const decoded = slotDecodedCount(slot);
  if (processed > 0 || decoded > 0) return;
  await sleepMs(4000);
  try {
    const slotsCtrl = new AbortController();
    const slotsTo = setTimeout(() => slotsCtrl.abort(), 2500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/slots`, { signal: slotsCtrl.signal });
      const again = res.ok ? await res.json() : null;
      const s2 = Array.isArray(again) ? again[0] : null;
      const processed2 = Number(s2?.n_prompt_tokens_processed) || 0;
      const decoded2 = slotDecodedCount(s2);
      if (s2?.is_processing && processed2 === 0 && decoded2 === 0) {
        throw new Error(
          `Qwen3.8-Flash-Next is stuck (prompt queued, 0 tokens processed). GPU job is dead — run: ${FLASH_NEXT_START_HINT}`,
        );
      }
    } finally {
      clearTimeout(slotsTo);
    }
  } catch (err) {
    if (err?.message && /Qwen3\.8-Flash-Next is stuck/.test(err.message)) throw err;
  }
}

/** Normalize local backend bases before code appends /v1/... paths. */
function normalizeLocalLmBaseUrl(value) {
  let base = String(value ?? '').trim();
  // Saved settings have been "http://localhost:8081." and "http://localhost:8081.v1".
  // Joining those to "v1/..." without a slash yields port "8081.v1", which fetch cannot parse.
  base = base.replace(/^(https?:\/\/[^/?#]*:\d+)\.+(?=\/|$)/i, '$1');
  base = base.replace(/^(https?:\/\/[^/?#]*:\d+)(?:\.v1|v1)(?=\/|$)/i, '$1');
  base = base.replace(/\/+$/, '');
  base = base.replace(/\.v1$/i, '');
  // Local endpoint builders append /v1 themselves; avoid /v1/v1/... from saved settings.
  if (base.endsWith('/v1')) base = base.slice(0, -3);
  return base;
}

/** Join base + path with exactly one slash. Never glue "v1" onto a trailing dot. */
function joinUrl(base, suffix) {
  let b = String(base ?? '').replace(/\/+$/, '').replace(/\.+$/, '');
  const s = String(suffix ?? '').replace(/^\/+/, '');
  if (!b) return s ? `/${s}` : '';
  return `${b}/${s}`;
}

/** Current LM Studio base URL (no trailing slash or /v1). Reads from localStorage so UI settings apply immediately. */
function getLmStudioBase() {
  const resolved =
    typeof localStorage === 'undefined'
      ? DEFAULT_BASE
      : (() => {
          const v = localStorage.getItem('lmStudioBaseUrl');
          if (v != null && String(v).trim() !== '') return normalizeLocalLmBaseUrl(v);
          const fromEnv = viteEnvStr('VITE_LM_STUDIO_BASE_URL');
          if (fromEnv) return normalizeLocalLmBaseUrl(fromEnv);
          return DEFAULT_BASE;
        })();
  if (resolved !== lastResolvedLmBase) {
    lastResolvedLmBase = resolved;
    lmsRestModelsListSupported = null;
    llamaRouterModelsSupported = null;
    lastLocalModelIds = [];
  }
  return resolved;
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
  const id = m.key ?? m.id ?? m.model ?? m.name ?? m.display_name;
  if (typeof id !== 'string' || !id.trim()) return null;
  const caps = endpointCapsFromRow(m) || (m.caps && typeof m.caps === 'object' ? m.caps : null);
  return caps ? { id: id.trim(), caps } : { id: id.trim() };
}

/** Dedupe by lowercase id (llama-server may list the same model under `models` and `data`). */
function mergeUniqueModelItems(entries) {
  const seen = new Set();
  const out = [];
  for (const m of entries) {
    const item = toModelItem(m);
    if (!item) continue;
    const k = item.id.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** llama.cpp router: GET /models response shapes (experimental). */
function extractRouterModelRows(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.models)) return data.models;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

/**
 * True when a GET /models payload comes from a llama.cpp **router** (many models, load/unload API).
 * Router rows always carry a `status` ("loaded" | "unloaded" | ...). A plain single-model
 * `llama-server` (e.g. the Flash-Next Docker server on :8081) also answers GET /models with 200 JSON
 * but its rows have no `status` and it has no POST /models/load, so treating it as a router made
 * Atom Chat try to "load" the model, get a 404, and report that the model would not load.
 * An empty list cannot be told apart, so it keeps the old "assume router" behavior.
 * @param {unknown} data
 * @returns {boolean}
 */
export function isLlamaRouterModelsPayload(data) {
  const rows = extractRouterModelRows(data);
  if (rows.length === 0) return true;
  return rows.some((m) => getRouterModelStatusValue(m) !== '');
}

function parseLlamaRouterModelsList(data) {
  const rows = extractRouterModelRows(data);
  const items = [];
  for (const m of rows) {
    const id = m?.id ?? m?.name ?? m?.model ?? m?.path;
    if (typeof id !== 'string' || !id.trim()) continue;
    const caps = endpointCapsFromRow(m);
    items.push(caps ? { id: id.trim(), caps } : { id: id.trim() });
  }
  return mergeUniqueModelItems(items);
}

/**
 * llama.cpp router reports status as a string OR `{ value: "loaded"|"loading"|"unloaded" }`.
 * `String({value:"loaded"})` becomes `"[object Object]"` — never matches — so loaded detection broke.
 * @param {object} m
 * @returns {string}
 */
function getRouterModelStatusValue(m) {
  if (!m || typeof m !== 'object') return '';
  if (typeof m.state === 'string') return m.state.toLowerCase().trim();
  if (typeof m.status === 'string') return m.status.toLowerCase().trim();
  if (m.status && typeof m.status === 'object' && m.status.value != null) {
    return String(m.status.value).toLowerCase().trim();
  }
  return '';
}

/** Loose match for router alias vs path vs basename. */
function modelIdsLooselyMatch(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.endsWith('/' + y) || y.endsWith('/' + x)) return true;
  const base = (s) => {
    const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    const leaf = slash >= 0 ? s.slice(slash + 1) : s;
    return leaf.replace(/\.gguf$/i, '');
  };
  const bx = base(x);
  const by = base(y);
  return !!(bx && by && (bx === by || bx.includes(by) || by.includes(bx)));
}

function getLoadedIdsFromRouterData(data) {
  const rows = extractRouterModelRows(data);
  const out = [];
  for (const m of rows) {
    const id = m?.id ?? m?.name ?? m?.model ?? m?.path;
    if (typeof id !== 'string' || !id.trim()) continue;
    const st = getRouterModelStatusValue(m);
    // "loading" occupies the models-max 1 slot — count it for unload waits.
    if (
      st === 'loaded' ||
      st === 'loading' ||
      st === 'ready' ||
      m?.loaded === true ||
      m?.is_active === true ||
      m?.active === true
    ) {
      out.push(id.trim());
    }
  }
  return out;
}

function findRouterModelRow(data, modelId) {
  const rows = extractRouterModelRows(data);
  for (const m of rows) {
    const id = m?.id ?? m?.name ?? m?.model ?? m?.path;
    if (typeof id === 'string' && id.trim() && modelIdsLooselyMatch(id, modelId)) return m;
  }
  return null;
}

/** True when router reports this model as fully chat-ready (not merely loading). */
function isRouterModelFullyLoaded(data, modelId) {
  const m = findRouterModelRow(data, modelId);
  if (!m) return false;
  const st = getRouterModelStatusValue(m);
  const statusObj = m.status && typeof m.status === 'object' ? m.status : {};
  if (statusObj.failed === true) return false;
  return st === 'loaded' || st === 'ready' || m?.loaded === true || m?.is_active === true || m?.active === true;
}

/** Child spawn died (bad GGUF / missing tensors). Do not wait 10 minutes. */
function isRouterModelLoadFailed(data, modelId) {
  const m = findRouterModelRow(data, modelId);
  if (!m) return false;
  const statusObj = m.status && typeof m.status === 'object' ? m.status : {};
  if (statusObj.failed === true) return true;
  if (statusObj.exit_code != null && Number(statusObj.exit_code) !== 0) {
    const st = getRouterModelStatusValue(m);
    if (st === 'unloaded' || st === 'failed') return true;
  }
  return false;
}

/**
 * True when the backend is llama.cpp in router mode (GET /models, POST /models/load|unload).
 * Caches true after a successful JSON response; caches false only on definitive 404/non-JSON
 * so a cold start (connection refused) can succeed on later calls.
 */
let cachedLocalNCtx = { at: 0, value: 0 };

/**
 * Live llama.cpp n_ctx (ATOM's server is --ctx-size 65536). Falls back to 65536
 * when /props is missing so we never send a 262k cloud thread at a local model.
 * @returns {Promise<number>}
 */
export async function probeLocalContextSize() {
  const now = Date.now();
  if (cachedLocalNCtx.value > 0 && now - cachedLocalNCtx.at < 30_000) return cachedLocalNCtx.value;
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  const remember = (n) => {
    cachedLocalNCtx = { at: now, value: n };
    return n;
  };
  try {
    const res = await fetch(`${base}/v1/models`, { signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json();
      for (const m of data?.data || []) {
        const loaded = Number(m?.meta?.n_ctx || 0);
        if (Number.isFinite(loaded) && loaded > 0) return remember(loaded);
        const args = m?.status?.args;
        if (Array.isArray(args)) {
          const i = args.indexOf('--ctx-size');
          if (i >= 0) {
            const n = Number(args[i + 1]);
            if (Number.isFinite(n) && n > 0) return remember(n);
          }
        }
      }
    }
  } catch {
    /* use default */
  } finally {
    clearTimeout(t);
  }
  return 65536;
}

export async function probeLlamaRouterModelsList() {
  if (llamaRouterModelsSupported !== null) return llamaRouterModelsSupported;
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${base}/models`, { method: 'GET', signal: ctrl.signal });
    if (res.status === 404) {
      llamaRouterModelsSupported = false;
      return false;
    }
    if (!res.ok) {
      return false;
    }
    const ct = res.headers.get('content-type') || '';
    if (!/json/i.test(ct)) {
      llamaRouterModelsSupported = false;
      return false;
    }
    const payload = await res.json();
    llamaRouterModelsSupported = isLlamaRouterModelsPayload(payload);
    return llamaRouterModelsSupported;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
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
    if (await tryFetch(`${base}/models`)) return true;
  } catch (_) { }
  try {
    if (await tryFetch(`${base}/v1/models`)) return true;
  } catch (_) { }
  try {
    return await tryFetch(`${base}/api/v1/models`);
  } catch {
    return false;
  }
}

/** Human-readable label for the model dropdown. "deepseek:deepseek-chat" → "DeepSeek: deepseek-chat". */
export function modelDisplayName(id) {
  if (!id || typeof id !== 'string') return id;
  const i = id.indexOf(':');
  if (i === -1) {
    if (id.endsWith('.gguf') && (id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id))) {
      const base = id.replace(/\\/g, '/').split('/').pop();
      return base ? `${base}  —  ${id}` : id;
    }
    return id;
  }
  const provider = id.slice(0, i);
  const label = CLOUD_PROVIDERS[provider]?.name ?? provider;
  return `${label}: ${id.slice(i + 1)}`;
}

/** Compact primary line in grouped model lists (provider shown in section header). */
export function modelSelectorPrimaryLine(id) {
  if (!id || typeof id !== 'string') return '';
  const i = id.indexOf(':');
  if (i > 0) {
    const rest = id.slice(i + 1).trim();
    return rest || id;
  }
  if (id.endsWith('.gguf') && (id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id))) {
    return id.replace(/\\/g, '/').split('/').pop() || id;
  }
  return id;
}

/** Optional subtitle (folder path for disk models). */
export function modelSelectorSecondaryLine(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.indexOf(':') > 0) return null;
  if (!(id.endsWith('.gguf') && (id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id)))) return null;
  const norm = id.replace(/\\/g, '/');
  const base = norm.split('/').pop();
  if (!base || norm.length <= base.length) return null;
  return norm.slice(0, norm.length - base.length - 1) || null;
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

/** Lowercase filename for deduping disk paths vs server-reported model names. */
function ggufBasenameLower(id) {
  if (!id || typeof id !== 'string') return '';
  const s = id.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return (i === -1 ? s : s.slice(i + 1)).toLowerCase();
}

/**
 * llama-server /v1/chat/completions expects the loaded model id (usually the .gguf basename).
 * Disk inventory uses absolute paths under ~/.lmstudio/models.
 */
function localModelIdForOpenAIRequest(id) {
  if (!id || typeof id !== 'string') return id;
  if (id.startsWith('/')) {
    const base = id.replace(/\\/g, '/').split('/').pop();
    return base && base.endsWith('.gguf') ? base : id;
  }
  if (/^[A-Za-z]:[\\/]/.test(id)) {
    const base = id.replace(/\\/g, '/').split('/').pop();
    return base && base.endsWith('.gguf') ? base : id;
  }
  return id;
}

/**
 * Merge server model list with disk scan: server order first.
 * Disk rows whose basename already appears on the server are skipped.
 * Two disk copies with the same filename in different folders both stay visible.
 * @param {{ id: string }[]} fromServer
 * @param {{ id: string }[]} fromDisk
 */
export function mergeServerAndDiskModels(fromServer, fromDisk) {
  const seenFull = new Set();
  const serverBases = new Set();
  const out = [];
  for (const m of fromServer || []) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    const fullKey = id.toLowerCase();
    if (seenFull.has(fullKey)) continue;
    seenFull.add(fullKey);
    const baseKey = ggufBasenameLower(id);
    if (baseKey.endsWith('.gguf')) serverBases.add(baseKey);
    out.push(m.caps && typeof m.caps === 'object' ? { id, caps: m.caps } : { id });
  }
  for (const m of fromDisk || []) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    const fullKey = id.toLowerCase();
    if (seenFull.has(fullKey)) continue;
    const baseKey = ggufBasenameLower(id);
    if (baseKey.endsWith('.gguf') && serverBases.has(baseKey)) continue;
    seenFull.add(fullKey);
    out.push(m.caps && typeof m.caps === 'object' ? { id, caps: m.caps } : { id });
  }
  return out;
}

function extraLocalModelDirsFromStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = (localStorage.getItem('localModelDirs') ?? '').trim();
    if (!raw) return [];
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s));
  } catch {
    return [];
  }
}

/** Dev: list .gguf paths from LM Studio, ~/models, llama.cpp cache, Downloads, and extra folders. */
async function fetchDiskModelInventory() {
  if (!import.meta.env.DEV) return [];
  const extra = extraLocalModelDirsFromStorage();
  const q = extra.length ? `?extra=${encodeURIComponent(extra.join('\n'))}` : '';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`/api/atom-local-disk-models${q}`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.models ?? data;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((m) => (typeof m?.id === 'string' ? { id: m.id.trim() } : null))
      .filter((m) => m && m.id);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** True when model id is Grok (grok:grok-4, etc.). Used to route to Responses API with tools for real-time search. */
export function isGrokModel(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('grok:');
}

/** True when model id is DeepSeek (deepseek:deepseek-chat, etc.). Used to route image generation. */
export function isDeepSeekModel(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('deepseek:');
}

/** True when model id is DeepInfra. Used to route to DeepInfra's OpenAI-compatible endpoint. */
function isDeepinfraModel(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('deepinfra:');
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
    ? ' Check Settings → Cloud APIs (Nous, DeepSeek, Grok, Cerebras, DeepInfra): confirm the key is correct, has no extra spaces, and is valid for the selected provider.'
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
      if (apiMessage) return apiMessage;
      if (bodyText && bodyText.trim()) {
        const t = bodyText.trim().slice(0, 500);
        return `The API server had an error (${status}). ${t}`;
      }
      return `The API server had an error (${status}). Try again later.`;
    case 400:
      if (code === 'model_not_found') return apiMessage || 'Model not found. Check the model name in Settings or try a different model.';
      if (code === 'context_length_exceeded' || /exceeds the available context size/i.test(apiMessage)) {
        return 'This chat is longer than the local model window. ATOM keeps recent turns only. Send again, or start a new chat.';
      }
      return apiMessage || 'Bad request. Check your request or try a different model.';
    default:
      return apiMessage || `Request failed (${status}). Try again or check Settings.`;
  }
}

/** Return cloud provider models when API key is set. Ids are "provider:modelId". */
async function getCloudModels() {
  try {
    return await fetchCloudModels();
  } catch {
    return [];
  }
}

/** Timeout for LM Studio model list fetch so we don't hang when server is down; then cloud-only list can still load. */
const LOCAL_MODELS_TIMEOUT_MS = 10000;

/** Timeout for cloud (Grok, DeepSeek) API requests when caller does not override. */
const CLOUD_REQUEST_TIMEOUT_MS = 300000;

/** Cloud stream fetch timeout from options (e.g. Arena execution setting); clamp 60s–15m. */
function resolveCloudStreamTimeoutMs(options) {
  const raw = options?.request_timeout_ms;
  if (raw != null && Number.isFinite(Number(raw))) {
    return Math.max(60_000, Math.min(900_000, Number(raw)));
  }
  return CLOUD_REQUEST_TIMEOUT_MS;
}

/**
 * Models reported by the inference server (LM Studio REST, llama-server /v1/models, etc.).
 * @returns {Promise<{ id: string }[]>}
 */
async function getLocalModelsFromServer() {
  const base = getLmStudioBase();
  const rest = `${base}/api/v1`;
  const openai = `${base}/v1`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), LOCAL_MODELS_TIMEOUT_MS);
  try {
    const routerRes = await fetch(`${base}/models`, { signal: ctrl.signal });
    if (routerRes.ok) {
      const ct = routerRes.headers.get('content-type') || '';
      if (/json/i.test(ct)) {
        const data = await routerRes.json();
        llamaRouterModelsSupported = isLlamaRouterModelsPayload(data);
        const fromRouter = parseLlamaRouterModelsList(data);
        if (fromRouter.length > 0) return fromRouter;
      }
    }
    const fallback = await fetch(`${openai}/models`, { signal: ctrl.signal });
    if (!fallback.ok) {
      const restRes = await fetch(`${rest}/models`, { signal: ctrl.signal });
      if (!restRes.ok) return [];
      const data = await restRes.json();
      const rawModels = Array.isArray(data.models) ? data.models : [];
      const rawData = Array.isArray(data.data) ? data.data : [];
      const rawTop = Array.isArray(data) ? data : [];
      const combined = [...rawModels, ...rawData, ...(rawModels.length || rawData.length ? [] : rawTop)];
      return mergeUniqueModelItems(combined.filter((m) => m && m.type !== 'embedding'));
    }
    const data = await fallback.json();
    const fromData = Array.isArray(data.data) ? data.data : [];
    const fromModels = Array.isArray(data.models) ? data.models : [];
    const rawArr = Array.isArray(data) && !fromData.length && !fromModels.length ? data : [];
    return mergeUniqueModelItems([
      ...fromData.filter((m) => m && m.type !== 'embedding'),
      ...fromModels.filter((m) => m && m.type !== 'embedding'),
      ...rawArr.filter((m) => m && m.type !== 'embedding'),
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(to);
  }
}

/**
 * Local models for chat/Arena.
 * When llama.cpp router is up, return **only** router-loadable ids (GET /models).
 * Merging disk paths caused 404s: UI showed Hermes / nested LM Studio paths that
 * --models-dir cannot load (router only indexes top-level .gguf + immediate subdirs).
 * Disk inventory is used only when the server list is empty (offline / first boot).
 * @returns {Promise<{ id: string }[]>}
 */
async function getLocalModels() {
  const fromServer = await attachFlashNextLiveCaps(await getLocalModelsFromServer());
  // getLocalModelsFromServer sets llamaRouterModelsSupported when GET /models works.
  if (fromServer.length > 0 && llamaRouterModelsSupported === true) {
    lastLocalModelIds = fromServer.map((x) => x.id);
    return fromServer;
  }
  const fromDisk = await fetchDiskModelInventory();
  const merged = mergeServerAndDiskModels(fromServer, fromDisk);
  lastLocalModelIds = merged.map((x) => x.id);
  return merged;
}

/**
 * True when the backend exposes LM Studio–style GET /api/v1/models (load/unload management).
 * llama-server (OpenAI route only) returns 404 — Arena should not rely on swapping models via REST.
 */
export async function probeLmsRestModelsList() {
  if (lmsRestModelsListSupported !== null) return lmsRestModelsListSupported;
  if (llamaRouterModelsSupported === true) {
    lmsRestModelsListSupported = false;
    return false;
  }
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${base}/api/v1/models`, { method: 'GET', signal: ctrl.signal });
    lmsRestModelsListSupported = res.ok;
    return lmsRestModelsListSupported;
  } catch {
    lmsRestModelsListSupported = false;
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * llama-server (classic): one GGUF at process start. Router mode: many ids from GET /models; chat uses the selected id.
 * When REST management is absent and exactly one local model is listed, map any local request to it so legacy Arena works.
 */
async function resolveEffectiveLocalChatModelId(modelId) {
  if (!modelId || typeof modelId !== 'string' || modelId.includes(':')) return modelId;
  if (await probeLlamaRouterModelsList()) return modelId;
  const lms = await probeLmsRestModelsList();
  if (lms) return modelId;
  let ids = lastLocalModelIds;
  if (ids.length === 0) {
    try {
      ids = (await getLocalModels()).map((m) => m.id);
    } catch {
      return modelId;
    }
  }
  if (ids.length === 1) return ids[0];
  const selBase = ggufBasenameLower(modelId);
  if (selBase) {
    const serverOnly = ids.filter((id) => !id.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(id));
    if (serverOnly.length === 1 && ggufBasenameLower(serverOnly[0]) === selBase) return serverOnly[0];
  }
  return modelId;
}

/**
 * Fetch list of models: local inference server + disk GGUFs + live cloud catalogs.
 * If the local server is unreachable, still returns cloud models when API keys are set.
 * @returns {Promise<{ id: string }[]>}
 */
export async function getModels() {
  const [local, cloud] = await Promise.all([
    getLocalModels().catch(() => []),
    getCloudModels(),
  ]);
  return [...local, ...cloud];
}

/**
 * Get model keys that are currently loaded in VRAM.
 * llama.cpp router: GET /models. LM Studio: GET /api/v1/models + loaded_instances.
 * @returns {Promise<string[]>}
 */
export async function getLoadedModelKeys() {
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    if (await probeLlamaRouterModelsList()) {
      const res = await fetch(`${base}/models`, { signal: ctrl.signal });
      if (!res.ok) return [];
      const data = await res.json();
      return getLoadedIdsFromRouterData(data);
    }
    const res = await fetch(`${base}/api/v1/models`, { signal: ctrl.signal });
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
  } catch (_) {
    return [];
  } finally {
    clearTimeout(to);
  }
}

/**
 * Unload one model instance by instance_id (LM Studio REST: POST body is { instance_id }).
 * @param {string} instanceId - From loaded_instances[].id in list response
 * @returns {Promise<{ instance_id?: string }>}
 */
export async function unloadByInstanceId(instanceId) {
  if (!instanceId || typeof instanceId !== 'string') return {};
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/api/v1/models/unload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instance_id: instanceId }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio unload: ${res.status} ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(to);
  }
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
  const ids = modelIds.map((id) => String(id).trim()).filter(Boolean);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const loaded = await getLoadedModelKeys();
    const anyStillLoaded = ids.some((id) => loaded.some((k) => modelIdsLooselyMatch(k, id)));
    if (!anyStillLoaded) return;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * True when this local id is already chat-ready (alias / path / basename).
 * Cloud ids are never "local ready".
 * @param {string} modelId
 * @returns {Promise<boolean>}
 */
export async function isLocalModelChatReady(modelId) {
  if (!modelId || typeof modelId !== 'string' || modelId.includes(':')) return false;
  if (isQwen38FlashNextSelection(modelId)) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 2500);
      try {
        const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/health`, { signal: ctrl.signal });
        return res.ok;
      } finally {
        clearTimeout(to);
      }
    } catch {
      return false;
    }
  }
  const base = getLmStudioBase();
  try {
    if (await probeLlamaRouterModelsList()) {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`${base}/models`, { signal: ctrl.signal });
        if (!res.ok) return false;
        return isRouterModelFullyLoaded(await res.json(), modelId);
      } finally {
        clearTimeout(to);
      }
    }
    const loaded = await getLoadedModelKeys();
    return loaded.some((k) => modelIdsLooselyMatch(k, modelId));
  } catch {
    return false;
  }
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
 * Cockpit/chat: if the router child is already up, skip. Otherwise POST /models/load
 * (which LRU-evicts when --models-max is hit) and wait until chat-ready.
 * Chat requests also pass ?autoload=true so a missed preload still swaps in-request.
 * Cloud ids (provider:model) are no-ops.
 * @param {string} modelId
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export async function ensureLocalModelReadyForChat(modelId, signal) {
  if (!modelId || typeof modelId !== 'string' || modelId.includes(':')) return;
  if (isQwen38FlashNextSelection(modelId)) {
    await assertFlashNextCanChat();
    return;
  }
  if (!(await probeLlamaRouterModelsList())) return;
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
  if (await isLocalModelChatReady(modelId)) return;
  await loadModel(modelId);
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
  const ready = await waitUntilLoaded(modelId, {
    pollIntervalMs: 500,
    timeoutMs: 600000,
  });
  if (!ready) {
    throw new Error(
      `Model failed to load: "${modelId}" did not become ready (bad GGUF, VRAM, or llama-server). Check llama-server.log.`,
    );
  }
}

/**
 * Wait until router status.value === "loaded" (chat-ready).
 * POST /models/load returns success as soon as the child is spawned — chat before ready fails.
 * @param {string} modelId
 * @param {Object} [opts]
 * @returns {Promise<boolean>}
 */
export async function waitUntilLoaded(modelId, opts = {}) {
  const { pollIntervalMs = 400, timeoutMs = 600000 } = opts;
  if (!modelId || typeof modelId !== 'string' || !modelId.trim()) return false;
  if (isQwen38FlashNextSelection(modelId)) return true;
  const base = getLmStudioBase();
  const start = Date.now();
  let sawLoading = false;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await probeLlamaRouterModelsList()) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(`${base}/models`, { signal: ctrl.signal });
          if (res.ok) {
            const data = await res.json();
            if (isRouterModelFullyLoaded(data, modelId)) return true;
            const row = findRouterModelRow(data, modelId);
            const st = row ? getRouterModelStatusValue(row) : '';
            if (st === 'loading') sawLoading = true;
            if (isRouterModelLoadFailed(data, modelId) || (sawLoading && st === 'unloaded')) {
              throw new Error(
                `Model failed to load: "${modelId}" (llama child exited). This GGUF may be incompatible. Check llama-server.log.`,
              );
            }
          }
        } finally {
          clearTimeout(to);
        }
      } else {
        const loaded = await getLoadedModelKeys();
        if (loaded.some((k) => modelIdsLooselyMatch(k, modelId))) return true;
      }
    } catch (e) {
      if (e && /failed to load/i.test(String(e.message || e))) throw e;
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return false;
}

/**
 * Load a model: llama.cpp router uses POST /models/load; LM Studio uses POST /api/v1/models/load.
 * @param {string} modelId - Model identifier (as in GET /v1/models or GET /models)
 * @param {Object} loadConfig
 * @param {number} [loadConfig.context_length]
 * @param {number} [loadConfig.eval_batch_size]
 * @param {boolean} [loadConfig.flash_attention]
 * @param {boolean} [loadConfig.offload_kv_cache_to_gpu]
 * @returns {Promise<object>}
 */
export async function loadModel(modelId, loadConfig = {}) {
  if (!modelId || typeof modelId !== 'string' || !modelId.trim()) {
    throw new Error('loadModel: model id required');
  }
  if (isQwen38FlashNextSelection(modelId)) {
    return { success: true, alreadyRunning: true };
  }
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 180000);
  try {
    if (await probeLlamaRouterModelsList()) {
      const id = modelId.trim();
      // Already chat-ready — do not call /models/load (returns 400 "already running").
      try {
        const probe = await fetch(`${base}/models`, { signal: ctrl.signal });
        if (probe.ok) {
          const data = await probe.json();
          if (isRouterModelFullyLoaded(data, id)) {
            return { success: true, alreadyRunning: true };
          }
        }
      } catch (_) {
        /* fall through to load */
      }
      const postLoad = () =>
        fetch(`${base}/models/load`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: id }),
          signal: ctrl.signal,
        });
      let res = await postLoad();
      if (!res.ok) {
        let text = await res.text();
        // Idempotent: concurrent Arena prep / double-click often hits this.
        if (
          res.status === 400 &&
          /already running|already loaded|already in use/i.test(text)
        ) {
          return { success: true, alreadyRunning: true };
        }
        // Slot full: unload occupants (except this id) and retry once.
        // POST /models/load already LRU-evicts; this covers the race / older binaries.
        if (res.status === 400 && /limit reached|try again later|too many models/i.test(text)) {
          const occupants = await getLoadedModelKeys();
          for (const occ of occupants) {
            if (!modelIdsLooselyMatch(occ, id)) await unloadModel(occ);
          }
          res = await postLoad();
          if (res.ok) return res.json().catch(() => ({}));
          text = await res.text();
          if (
            res.status === 400 &&
            /already running|already loaded|already in use/i.test(text)
          ) {
            return { success: true, alreadyRunning: true };
          }
        }
        throw new Error(`llama-server load: ${res.status} ${text}`);
      }
      return res.json().catch(() => ({}));
    }
    if (!(await probeLmsRestModelsList())) {
      // Classic single-model llama-server (one GGUF chosen at process start, e.g. Flash-Next on :8081).
      // The served model is already resident, so "load" is a no-op instead of a false failure.
      const served = (await getLocalModelsFromServer()).map((m) => m.id);
      if (served.some((id) => modelIdsLooselyMatch(id, modelId))) {
        return { success: true, alreadyRunning: true, singleModelServer: true };
      }
      throw new Error(
        served.length
          ? `This server hosts a single fixed model (${served.join(', ')}) and cannot load "${modelId}". Pick the served model or switch the backend URL.`
          : 'This backend has no model-load API. Use llama.cpp server with router mode (Atom launcher) or LM Studio.',
      );
    }
    const body = { model: modelId };
    if (loadConfig.context_length != null && Number(loadConfig.context_length) > 0) {
      body.context_length = loadConfig.context_length;
    }
    if (loadConfig.eval_batch_size != null) body.eval_batch_size = loadConfig.eval_batch_size;
    if (loadConfig.flash_attention != null) body.flash_attention = loadConfig.flash_attention;
    if (loadConfig.offload_kv_cache_to_gpu != null) body.offload_kv_cache_to_gpu = loadConfig.offload_kv_cache_to_gpu;
    body.echo_load_config = true;
    const res = await fetch(`${base}/api/v1/models/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LM Studio load: ${res.status} ${text}`);
    }
    return res.json();
  } finally {
    clearTimeout(to);
  }
}

/**
 * Get loaded instance IDs for a single model key (from GET /api/v1/models: model.key + loaded_instances[].id).
 * @param {string} modelKey - Model key to match (m.key ?? m.id)
 * @returns {Promise<string[]>}
 */
export async function getLoadedInstanceIdsForModel(modelKey) {
  if (!modelKey || typeof modelKey !== 'string') return [];
  const base = getLmStudioBase();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${base}/api/v1/models`, { signal: ctrl.signal });
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
  } catch (_) {
    return [];
  } finally {
    clearTimeout(to);
  }
}

/**
 * Unload a model from memory: llama.cpp router POST /models/unload; LM Studio uses instance ids.
 * @param {string} modelId - Model key (e.g. from load or list)
 * @returns {Promise<void>}
 */
export async function unloadModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return;
  const base = getLmStudioBase();
  if (await probeLlamaRouterModelsList()) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 120000);
    try {
      await fetch(`${base}/models/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId.trim() }),
        signal: ctrl.signal,
      });
    } catch (_) {
      /* ignore */
    } finally {
      clearTimeout(to);
    }
    return;
  }
  const instanceIds = await getLoadedInstanceIdsForModel(modelId);
  await Promise.allSettled(instanceIds.map((id) => unloadByInstanceId(id).catch(() => { })));
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
 * Unload every loaded model: llama.cpp router POST /models/unload per id; LM Studio uses instance unload.
 * @returns {Promise<{ ok: boolean, unloaded: number }>}
 */
export async function unloadAllModelsNative() {
  try {
    const base = getLmStudioBase();
    if (await probeLlamaRouterModelsList()) {
      const loaded = await getLoadedModelKeys();
      let unloaded = 0;
      for (const id of loaded) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 120000);
        try {
          const res = await fetch(`${base}/models/unload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: id }),
            signal: ctrl.signal,
          });
          if (res.ok) unloaded += 1;
        } catch (_) {
          /* continue */
        } finally {
          clearTimeout(to);
        }
      }
      return { ok: true, unloaded };
    }
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(`${base}/api/v1/models`, { signal: ctrl.signal });
    } finally {
      clearTimeout(to);
    }
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
    await Promise.allSettled(instanceIds.map((id) => unloadByInstanceId(id).catch(() => { })));
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
    width: Math.max(128, Math.min(2048, Number(width) || 1024)),
    height: Math.max(128, Math.min(2048, Number(height) || 1024)),
  };
  if (negative_prompt != null && String(negative_prompt).trim() !== '') body.negative_prompt = String(negative_prompt).trim();
  const url = `${DEEPINFRA_INFERENCE_BASE}/${modelId}`;
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
      });
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
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

/**
 * DeepInfra inference URL. Dev uses the Vite proxy so the browser is not blocked by CORS.
 * @param {string} path
 */
export function deepinfraInferenceUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return `/api/deepinfra${p}`;
  return `https://api.deepinfra.com${p}`;
}

/**
 * Call DeepInfra Kokoro-82M TTS API for text-to-speech. Returns audio blob.
 * @param {{ apiKey: string, text: string, voice: string, speed?: number }} opts
 * @returns {Promise<Blob>}
 */
export async function requestDeepInfraKokoroSpeech({ apiKey, text, voice = 'af_bella', speed = 1 }) {
  const key = (apiKey || '').trim() || viteEnvStr('VITE_DEEPINFRA_API_KEY');
  if (!key) throw new Error('DeepInfra API key is required for Kokoro TTS.');
  const res = await fetch(deepinfraInferenceUrl('/v1/audio/speech'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'hexgrad/Kokoro-82M',
      input: text,
      voice,
      speed: Math.max(0.5, Math.min(2, Number(speed) || 1)),
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Kokoro TTS: ${res.status} ${res.statusText}${errText ? ' — ' + errText : ''}`);
  }
  return res.blob();
}
