import { writable } from 'svelte/store';
import { resolveHfRepoForIcon, fetchReadmeFirstImageUrl } from './huggingface.js';

/**
 * Map LM Studio model id to icon filename in /model-icons/
 * Icons are in public/model-icons/ (e.g. qwen-color.svg).
 */
const MODEL_ICON_MAP = [
  [/meta[-_]?llama|llama|meta\b/i, 'meta-llama-color.svg'],
  [/microsoft|phi\s*3|phi3|\bphi\b/i, 'microsoft-phi-color.svg'],
  [/baidu|ernie/i, 'baidu-ernie-color.svg'],
  [/zai[-_]?org|zai\b/i, 'zai-color.svg'],
  [/dasd|thinking/i, 'dasd-thinking-color.svg'],
  [/deepseek/i, 'deepseek-color.svg'],
  [/dolphin/i, 'dolphin-color.svg'],
  [/gemma|google/i, 'gemma-color.svg'],
  [/glm|glmv/i, 'glmv-color.svg'],
  [/mistral|minstral|ministral/i, 'mistral-color.svg'],
  [/qwen|qwq/i, 'qwen-color.svg'],
  [/falcon/i, 'tii-falcon-color.svg'],
  [/codellama|code.?llama/i, 'meta-llama-color.svg'],
];

/** Fallback when no pattern matches and not in cache. Never show a model without an icon. */
const DEFAULT_ICON = '/model-icons/default-model.svg';

const CACHE_KEY = 'modelIconCache';

function loadCache() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const j = localStorage.getItem(CACHE_KEY);
    return j ? JSON.parse(j) : {};
  } catch {
    return {};
  }
}

let cache = loadCache();

function saveCache() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

/** @param {string|RegExp} p @param {string} s */
function patternMatches(p, s) {
  return p instanceof RegExp ? p.test(s) : s.includes(String(p));
}

/**
 * Ensure every model id has an icon: try to fetch the real icon from Hugging Face (model card image).
 * If we already have a local pattern or cache, skip. Otherwise show default immediately, then
 * fetch from HF and replace with real icon when found.
 * @param {string[]} modelIds
 */
export function ensureModelIcons(modelIds) {
  if (!Array.isArray(modelIds) || modelIds.length === 0) return;
  const toFetch = [];
  for (const id of modelIds) {
    if (!id || typeof id !== 'string') continue;
    if (cache[id]) continue;
    const lower = id.toLowerCase();
    let hasPattern = false;
    for (const [pattern] of MODEL_ICON_MAP) {
      if (patternMatches(pattern, lower)) {
        hasPattern = true;
        break;
      }
    }
    if (hasPattern) continue;
    cache[id] = DEFAULT_ICON;
    toFetch.push(id);
  }
  if (toFetch.length > 0) {
    saveCache();
    publishCache();
    fetchAndFillIcons(toFetch);
  }
}

/**
 * Background: for each model id, resolve HF repo, fetch README first image, cache and publish.
 * @param {string[]} modelIds
 */
async function fetchAndFillIcons(modelIds) {
  for (const id of modelIds) {
    try {
      const repoId = await resolveHfRepoForIcon(id);
      if (!repoId) continue;
      const imageUrl = await fetchReadmeFirstImageUrl(repoId);
      if (imageUrl) {
        cache[id] = imageUrl;
        saveCache();
        publishCache();
      }
    } catch {
      // keep default icon
    }
  }
}

/**
 * @param {string} modelId - LM Studio model id
 * @param {Record<string,string>} [overrides] - Optional cache snapshot for reactivity (e.g. $modelIconOverrides)
 * @returns {string} - Path to icon (or default); never null
 */
export function getModelIcon(modelId, overrides) {
  if (!modelId || typeof modelId !== 'string') return DEFAULT_ICON;
  const lower = modelId.toLowerCase();
  for (const [pattern, filename] of MODEL_ICON_MAP) {
    if (patternMatches(pattern, lower)) return `/model-icons/${filename}`;
  }
  const c = overrides ?? cache;
  if (c[modelId]) return c[modelId];
  return DEFAULT_ICON;
}

/** Store of cache so UI can subscribe and re-render when cache is updated. */
export const modelIconOverrides = writable(loadCache());

function publishCache() {
  modelIconOverrides.set({ ...cache });
}

/** Parse quantization from model id (e.g. q4_k_m, Q5_K_S) */
export function getQuantization(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  const match = modelId.match(/\bq([0-9])[_\-\s]*k[_\-\s]*([sml])?/i);
  if (!match) return null;
  const [, q, suffix] = match;
  return suffix ? `Q${q}_K_${suffix.toUpperCase()}` : `Q${q}_K`;
}
