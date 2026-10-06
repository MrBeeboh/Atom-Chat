/**
 * Cloud model catalogs: live GET /v1/models when an API key is set, plus fallbacks
 * so the selector still fills if a vendor is down or CORS blocks the probe.
 */

import {
  buildProviderCheckRow,
  fundingProbe,
  providerStartupReport,
  setStartupFunding,
} from './providerFunding.js';
import { get } from 'svelte/store';

function viteEnvStr(key) {
  const map = {
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

function isDev() {
  return typeof import.meta !== 'undefined' && !!import.meta.env?.DEV;
}

/** @type {Record<string, { name: string, baseUrl: string, modelsPath: string, listUrlDev: string, fallbackModels: string[], getKey: () => string }>} */
export const CLOUD_PROVIDERS = {
  nous: {
    name: 'Nous',
    baseUrl: isDev() ? '/api/nous/v1' : 'https://inference-api.nousresearch.com/v1',
    modelsPath: '/models',
    listUrlDev: '/api/nous/v1/models',
    fallbackModels: [
      'stealth/ox-alpha',
      'z-ai/glm-5.2',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-haiku-4.5',
      'openai/gpt-5.5',
      'openai/gpt-5.6-luna',
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
      'google/gemini-3.7-flash',
      'x-ai/grok-4.6',
      'qwen/qwen3.8-max',
      'moonshotai/kimi-k3',
      'minimax/minimax-m3',
      'nvidia/nemotron-3-super-120b-a12b',
      'stepfun/step-3.7-flash',
      'sakana/fugu-ultra',
    ],
    getKey: () => {
      const k = localStorageOrVite('nousApiKey', 'VITE_NOUS_API_KEY');
      if (k) return k;
      // Dev proxy attaches the Hermes Portal token from ~/.hermes/auth.json.
      return isDev() ? 'hermes-oauth' : '';
    },
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    modelsPath: '/v1/models',
    listUrlDev: '/api/deepseek/v1/models',
    fallbackModels: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    getKey: () => localStorageOrVite('deepSeekApiKey', 'VITE_DEEPSEEK_API_KEY'),
  },
  grok: {
    name: 'Grok',
    baseUrl: 'https://api.x.ai/v1',
    modelsPath: '/models',
    listUrlDev: '/api/xai/v1/models',
    fallbackModels: [
      'grok-4.6',
      'grok-4.5',
      'grok-4.3',
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4.20-multi-agent-0309',
      'grok-4.1-fast',
      'grok-build-0.1',
      'grok-4-latest',
      'grok-4',
      'grok-3-mini',
      'grok-3',
      'grok-4-1-fast-reasoning',
      'grok-4-1-fast-non-reasoning',
      'grok-4-fast-reasoning',
      'grok-imagine-image',
      'grok-imagine-image-2.0',
      'grok-imagine-image-quality',
      'grok-imagine-video',
      'grok-imagine-video-1.5',
    ],
    getKey: () => localStorageOrVite('grokApiKey', 'VITE_GROK_API_KEY'),
  },
  cerebras: {
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    modelsPath: '/models',
    listUrlDev: '/api/cerebras/v1/models',
    fallbackModels: [
      'gpt-oss-120b',
      'gemma-4-31b',
      'zai-glm-4.7',
      'llama-3.3-70b',
      'qwen-3-32b',
      'llama-4-scout-17b-16e-instruct',
      'llama3.1-8b',
      'llama3.1-70b',
      'deepseek-r1-distill-llama-70b',
    ],
    getKey: () => localStorageOrVite('cerebrasApiKey', 'VITE_CEREBRAS_API_KEY'),
  },
  deepinfra: {
    name: 'DeepInfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    modelsPath: '/models',
    listUrlDev: '/api/deepinfra/v1/openai/models',
    fallbackModels: [
      'meta-llama/Llama-3.3-70B-Instruct',
      'meta-llama/Llama-3.1-8B-Instruct',
      'meta-llama/Llama-3.1-405B-Instruct-Turbo',
      'mistralai/Mistral-Small-3.1-24B-Instruct-2503',
      'Qwen/Qwen3-235B-A22B',
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen2.5-32B-Instruct',
      'Qwen/Qwen2.5-14B-Instruct',
      'Qwen/Qwen2.5-7B-Instruct',
      'nvidia/Llama-3.3-Nemotron-Super-49B-v1',
      'microsoft/Phi-4-multimodal-instruct',
      'deepseek-ai/DeepSeek-R1',
      'deepseek-ai/DeepSeek-V3-0324',
      'google/gemma-2-27b-it',
      'google/gemma-2-9b-it',
    ],
    getKey: () => localStorageOrVite('deepinfraApiKey', 'VITE_DEEPINFRA_API_KEY'),
  },
};

const MODEL_TYPE_TAGS = {
  'grok-4.6': 'Flagship',
  'grok-4.5': 'Flagship',
  'grok-4.3': 'Reasoning',
  'grok-4.20-0309-reasoning': 'Reasoning',
  'grok-4.20-0309-non-reasoning': 'Fast Chat',
  'grok-4.20-multi-agent-0309': 'Multi-agent',
  'grok-4.1-fast': 'Fast Chat',
  'grok-build-0.1': 'Code',
  'grok-4-latest': 'Latest',
  'grok-3-mini': 'Mini Chat',
  'grok-3': 'General Chat',
  'grok-4': 'Reasoning',
  'grok-4-1-fast-reasoning': 'Legacy',
  'grok-4-1-fast-non-reasoning': 'Legacy',
  'grok-4-fast-reasoning': 'Legacy',
  'grok-imagine-image': 'Image',
  'grok-imagine-image-2.0': 'Image',
  'grok-imagine-image-quality': 'Image',
  'grok-imagine-video': 'Video',
  'grok-imagine-video-1.5': 'Video',
  'stealth/ox-alpha': 'Free',
  'z-ai/glm-5.2': 'Chat',
  'anthropic/claude-sonnet-5': 'Chat',
  'anthropic/claude-haiku-4.5': 'Fast Chat',
  'openai/gpt-5.5': 'Chat',
  'openai/gpt-5.6-luna': 'Fast Chat',
  'google/gemini-3.7-flash': 'Fast',
  'x-ai/grok-4.6': 'Flagship',
  'qwen/qwen3.8-max': 'Chat',
  'moonshotai/kimi-k3': 'Chat',
  'minimax/minimax-m3': 'Chat',
  'nvidia/nemotron-3-super-120b-a12b': 'Chat',
  'stepfun/step-3.7-flash': 'Fast',
  'sakana/fugu-ultra': 'Chat',
  'deepseek-v4-flash': 'Fast',
  'deepseek-v4-pro': 'Reasoning',
  'deepseek-chat': 'Legacy',
  'deepseek-reasoner': 'Legacy',
  'gpt-oss-120b': 'Chat',
  'gemma-4-31b': 'Chat',
  'zai-glm-4.7': 'Reasoning',
  'llama3.1-8b': 'Fast Chat',
  'llama3.1-70b': 'Chat',
  'llama-3.3-70b': 'Chat',
  'llama-4-scout-17b-16e-instruct': 'Scout',
  'qwen-3-32b': 'Chat',
  'deepseek-r1-distill-llama-70b': 'Reasoning',
  'meta-llama/Llama-3.3-70B-Instruct': 'Chat',
  'meta-llama/Llama-3.1-8B-Instruct': 'Fast Chat',
  'meta-llama/Llama-3.1-405B-Instruct-Turbo': 'Chat',
  'mistralai/Mistral-Small-3.1-24B-Instruct-2503': 'Chat',
  'Qwen/Qwen3-235B-A22B': 'Chat',
  'Qwen/Qwen2.5-72B-Instruct': 'Chat',
  'Qwen/Qwen2.5-32B-Instruct': 'Chat',
  'Qwen/Qwen2.5-14B-Instruct': 'Chat',
  'Qwen/Qwen2.5-7B-Instruct': 'Fast Chat',
  'nvidia/Llama-3.3-Nemotron-Super-49B-v1': 'Chat',
  'microsoft/Phi-4-multimodal-instruct': 'Multimodal',
  'deepseek-ai/DeepSeek-R1': 'Reasoning',
  'deepseek-ai/DeepSeek-V3-0324': 'Chat',
  'google/gemma-2-27b-it': 'Chat',
  'google/gemma-2-9b-it': 'Fast Chat',
};

const CLOUD_LIST_TIMEOUT_MS = 8000;
const CLOUD_CACHE_MS = 60_000;

/** @type {{ fingerprint: string, at: number, models: { id: string, origin?: string }[] } | null} */
let cloudCache = null;

export function cloudProviderLabel(providerId) {
  return CLOUD_PROVIDERS[providerId]?.name ?? (providerId ? providerId.charAt(0).toUpperCase() + providerId.slice(1) : '');
}

export function cloudModelsListUrl(providerId) {
  const p = CLOUD_PROVIDERS[providerId];
  if (!p) return '';
  if (isDev() && p.listUrlDev) return p.listUrlDev;
  return `${p.baseUrl.replace(/\/$/, '')}${p.modelsPath || '/models'}`;
}

/** Bare model id (strip `provider:` prefix). */
export function cloudModelPart(id) {
  if (!id || typeof id !== 'string') return '';
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

/**
 * Drop embeddings / STT from the chat selector. Image, video, and voice stay visible.
 * @param {string} modelPart
 */
export function isSelectableCloudModel(modelPart) {
  if (!modelPart || typeof modelPart !== 'string') return false;
  const s = modelPart.toLowerCase();
  if (/(^|[/_.-])(embed|embedding|embeddings)([/_.-]|$)/.test(s)) return false;
  if (/\b(bge-|e5-|gte-|minilm|text-embedding)/.test(s)) return false;
  if (/whisper/.test(s)) return false;
  return true;
}

/** @param {string} modelPart */
export function inferCloudTypeTag(modelPart) {
  if (!modelPart) return null;
  if (MODEL_TYPE_TAGS[modelPart]) return MODEL_TYPE_TAGS[modelPart];
  const s = modelPart.toLowerCase();
  if (/imagine[-.]?video|[-./]video/.test(s) && /grok|imagine/.test(s)) return 'Video';
  if (/imagine|image-gen|[-./]image/.test(s) && /grok|flux|sdxl|stable[-.]?diff/.test(s)) return 'Image';
  if (/voice|tts|stt|speech/.test(s)) return 'Voice';
  if (/build|code[-.]?fast|coder/.test(s)) return 'Code';
  if (/multi[-.]?agent/.test(s)) return 'Multi-agent';
  if (/non[-.]?reason/.test(s)) return 'Fast Chat';
  if (/reason|think|[-.]pro$|[-.]pro[-.]/.test(s)) return 'Reasoning';
  if (/flash|fast|mini|nano/.test(s)) return 'Fast';
  if (/latest/.test(s)) return 'Latest';
  if (/legacy|deprecated/.test(s)) return 'Legacy';
  return 'Chat';
}

/** Short tag next to a model name. */
export function getModelTypeTag(id) {
  if (!id || typeof id !== 'string') return null;
  const modelPart = cloudModelPart(id);
  if (!modelPart) return null;
  if (id.includes(':')) return inferCloudTypeTag(modelPart);
  return MODEL_TYPE_TAGS[modelPart] ?? null;
}

/**
 * @param {unknown} data
 * @returns {string[]}
 */
export function parseOpenAIModelsList(data) {
  if (!data) return [];
  const rows = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : [];
  const seen = new Set();
  const out = [];
  for (const m of rows) {
    const id = typeof m === 'string' ? m : (m?.id ?? m?.name ?? m?.model);
    if (typeof id !== 'string' || !id.trim()) continue;
    const t = id.trim();
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Live ids first, then fallback ids not already present.
 * @param {string[]} live
 * @param {string[]} fallback
 */
export function mergeLiveAndFallback(live, fallback) {
  const seen = new Set();
  const out = [];
  for (const id of [...(live || []), ...(fallback || [])]) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const t = id.trim();
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function keyFingerprint() {
  return Object.entries(CLOUD_PROVIDERS)
    .map(([id, p]) => `${id}:${p.getKey()?.trim() ? '1' : '0'}`)
    .join(',');
}

const startupModelLists = new Map();

async function fetchProviderModelIds(providerId) {
  if (startupModelLists.has(providerId)) return startupModelLists.get(providerId);
  const p = CLOUD_PROVIDERS[providerId];
  if (!p) return { ids: [], origin: 'fallback' };
  const key = p.getKey()?.trim();
  if (!key) return { ids: [], origin: 'fallback' };

  const url = cloudModelsListUrl(providerId);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CLOUD_LIST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return { ids: p.fallbackModels.slice(), origin: 'fallback' };
    const data = await res.json();
    const live = parseOpenAIModelsList(data).filter(isSelectableCloudModel);
    if (live.length === 0) return { ids: p.fallbackModels.slice(), origin: 'fallback' };
    return { ids: mergeLiveAndFallback(live, p.fallbackModels), origin: 'live' };
  } catch {
    return { ids: p.fallbackModels.slice(), origin: 'fallback' };
  } finally {
    clearTimeout(t);
  }
}

/** Sync fallback-only list (no network). Used when live fetch is skipped. */
export function getCloudModelsFallback() {
  const out = [];
  for (const [providerId, p] of Object.entries(CLOUD_PROVIDERS)) {
    if (!p.getKey()?.trim()) continue;
    for (const modelId of p.fallbackModels) {
      if (!isSelectableCloudModel(modelId)) continue;
      out.push({ id: `${providerId}:${modelId}`, origin: 'fallback' });
    }
  }
  return out;
}

/**
 * Cloud models for the selector. Live catalog when the key works; otherwise fallbacks.
 * @returns {Promise<{ id: string, origin?: string }[]>}
 */
/** One check per page load. invalidateCloudModelCache does not clear this. */
let startupFundingPromise = null;

async function readProviderFunding(providerId) {
  const provider = CLOUD_PROVIDERS[providerId];
  const key = provider?.getKey()?.trim();
  const probe = fundingProbe(providerId, { dev: isDev(), modelsUrl: cloudModelsListUrl(providerId) });
  const prior = (get(providerStartupReport) || []).find((row) => row.id === providerId) || null;
  const base = { id: providerId, name: provider?.name || providerId, hasKey: !!key, prior };
  if (!key) return { ...buildProviderCheckRow(base), probe: probe.kind, url: probe.url };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLOUD_LIST_TIMEOUT_MS);
  try {
    const res = await fetch(probe.url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const bodyText = await res.text();
    let body = null;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
    const row = buildProviderCheckRow({ ...base, status: res.status, body, bodyText });
    return { ...row, probe: probe.kind, url: probe.url };
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    const row = buildProviderCheckRow({ ...base, timedOut, status: 0, bodyText: '' });
    return { ...row, probe: probe.kind, url: probe.url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs on the first model load of this page (app startup). A reload starts
 * a new check. Results are not stored on disk.
 */
export function ensureStartupFundingCheck() {
  if (!startupFundingPromise) {
    startupFundingPromise = (async () => {
      const ids = Object.keys(CLOUD_PROVIDERS);
      const results = await Promise.all(ids.map((id) => readProviderFunding(id)));
      startupModelLists.clear();
      for (const result of results) {
        const state = result.fundingState === 'error' ? 'error' : result.funded ? 'funded' : 'not-funded';
        console.info(`[ATOM] funding ${result.id} ${state} (${result.fundingState}/${result.priceState}) ${result.probe} ${result.url} prices=${result.prices?.length || 0}`);
        if (result.funded) {
          startupModelLists.set(result.id, {
            ids: result.modelIds || [],
            origin: result.modelIds?.length ? 'live' : 'fallback',
          });
        }
      }
      providerStartupReport.set(results.map(({ probe, url, ...row }) => row));
      const map = Object.fromEntries(results.map((result) => [result.id, result.funded === true]));
      setStartupFunding(map, ids);
      return map;
    })();
  }
  return startupFundingPromise;
}

export async function fetchCloudModels() {
  const fingerprint = keyFingerprint();
  const now = Date.now();
  if (cloudCache && cloudCache.fingerprint === fingerprint && now - cloudCache.at < CLOUD_CACHE_MS) {
    return cloudCache.models;
  }

  const funding = await ensureStartupFundingCheck();
  const entries = Object.entries(CLOUD_PROVIDERS).filter(([id, p]) => p.getKey()?.trim() && funding[id] === true);
  if (entries.length === 0) {
    cloudCache = { fingerprint, at: now, models: [] };
    return [];
  }

  const results = await Promise.all(entries.map(([id]) => fetchProviderModelIds(id)));
  const out = [];
  entries.forEach(([providerId], i) => {
    const { ids, origin } = results[i];
    for (const modelId of ids) {
      if (!isSelectableCloudModel(modelId)) continue;
      out.push({ id: `${providerId}:${modelId}`, origin });
    }
  });
  cloudCache = { fingerprint, at: now, models: out };
  return out;
}

/** Drop cached live lists (e.g. after an API key change). */
export function invalidateCloudModelCache() {
  cloudCache = null;
}

/** Test hook. A real app reload clears module state without this. */
export function resetStartupFundingCheckForTests() {
  startupFundingPromise = null;
  startupModelLists.clear();
  providerStartupReport.set([]);
}
