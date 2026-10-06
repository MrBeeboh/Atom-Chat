/**
 * Backend base-URL and auth configuration for the API client. Extracted from
 * api.js. Owns `getLmStudioBase`, which also invalidates the shared probe caches
 * in `apiState` when the base URL changes.
 */
import { CLOUD_PROVIDERS } from '$lib/cloudCatalog.js';
import { apiState } from '$lib/apiState.js';

// Default backend is the llama.cpp router on port 8080 (Flash-Next is proxied there).
// LM Studio still works if you change the URL in Settings → Connection.
const DEFAULT_BASE = typeof import.meta !== 'undefined' && import.meta.env?.DEV ? '/api/llama' : 'http://localhost:8080';

export function viteEnvStr(key) {
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

export function localStorageOrVite(storageKey, viteName) {
  const fromEnv = viteEnvStr(viteName);
  if (fromEnv) return fromEnv;
  if (typeof localStorage !== 'undefined') {
    return (localStorage.getItem(storageKey) ?? '').trim();
  }
  return '';
}

/** Normalize local backend bases before code appends /v1/... paths. */
export function normalizeLocalLmBaseUrl(value) {
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
export function joinUrl(base, suffix) {
  let b = String(base ?? '').replace(/\/+$/, '').replace(/\.+$/, '');
  const s = String(suffix ?? '').replace(/^\/+/, '');
  if (!b) return s ? `/${s}` : '';
  return `${b}/${s}`;
}

/** Current LM Studio base URL (no trailing slash or /v1). Reads from localStorage so UI settings apply immediately. */
export function getLmStudioBase() {
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
  if (resolved !== apiState.lastResolvedLmBase) {
    apiState.lastResolvedLmBase = resolved;
    apiState.lmsRestModelsListSupported = null;
    apiState.llamaRouterModelsSupported = null;
    apiState.lastLocalModelIds = [];
  }
  return resolved;
}

/** Unload helper base URL (e.g. http://localhost:8766). Bulk eject uses POST {url}/unload-all. */
export function getUnloadHelperUrl() {
  if (typeof localStorage === 'undefined') return '';
  try {
    const v = localStorage.getItem('lmStudioUnloadHelperUrl');
    return v != null && String(v).trim() !== '' ? String(v).trim().replace(/\/$/, '') : '';
  } catch (_) {
    return '';
  }
}

/** Get base URL and headers for a given model id. Local models use LM Studio; "provider:modelId" use cloud. */
export function getBaseAndAuth(modelId) {
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

/** Timeout for LM Studio model list fetch so we don't hang when server is down; then cloud-only list can still load. */
export const LOCAL_MODELS_TIMEOUT_MS = 10000;

/** Timeout for cloud (Grok, DeepSeek) API requests when caller does not override. */
export const CLOUD_REQUEST_TIMEOUT_MS = 300000;

/** Cloud stream fetch timeout from options (e.g. Arena execution setting); clamp 60s–15m. */
export function resolveCloudStreamTimeoutMs(options) {
  const raw = options?.request_timeout_ms;
  if (raw != null && Number.isFinite(Number(raw))) {
    return Math.max(60_000, Math.min(900_000, Number(raw)));
  }
  return CLOUD_REQUEST_TIMEOUT_MS;
}
