/**
 * Live cloud model list prices (USD per 1M tokens).
 * Fetched on every app startup from the LiteLLM public catalog so the selector
 * shows current provider rates, not a stale hardcoded table.
 */

import { writable, get } from 'svelte/store';
import { models } from '$lib/stores.js';

export const LITELLM_PRICE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

/** Same-origin path: Vite proxies this in `npm run dev`; search-proxy also serves it. */
export const LOCAL_PRICE_URL = '/api/model-prices';

const PROVIDER_PREFIXES = {
  grok: ['xai/', 'x-ai/'],
  deepseek: ['deepseek/', ''],
  cerebras: ['cerebras/'],
  deepinfra: ['deepinfra/'],
};

/** @typedef {{ inPerM: number, outPerM: number, catalogId: string }} PriceRate */

/**
 * @typedef {{
 *   status: 'idle' | 'loading' | 'ready' | 'error',
 *   fetchedAt: number | null,
 *   source: string | null,
 *   error: string | null,
 *   rates: Record<string, PriceRate>,
 * }} ModelPricingState
 */

/** @type {import('svelte/store').Writable<ModelPricingState>} */
export const modelPricing = writable({
  status: 'idle',
  fetchedAt: null,
  source: null,
  error: null,
  rates: {},
});

/** @type {Record<string, { inPerM: number, outPerM: number }> | null} */
let catalogIndex = null;

/** @type {Promise<boolean> | null} */
let inflight = null;

export function parseAtomModelId(atomId) {
  if (!atomId || typeof atomId !== 'string') return { provider: null, part: '' };
  const colon = atomId.indexOf(':');
  if (colon <= 0) return { provider: null, part: atomId };
  return {
    provider: atomId.slice(0, colon).toLowerCase(),
    part: atomId.slice(colon + 1),
  };
}

export function isLocalModelId(atomId) {
  return parseAtomModelId(atomId).provider == null;
}

/**
 * LiteLLM table → lowercase id → { inPerM, outPerM }.
 * @param {Record<string, unknown>} table
 */
export function indexLiteLLMTable(table) {
  /** @type {Record<string, { inPerM: number, outPerM: number }>} */
  const index = {};
  if (!table || typeof table !== 'object') return index;
  for (const [key, raw] of Object.entries(table)) {
    if (key === 'sample_spec' || !raw || typeof raw !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const inn = Number(row.input_cost_per_token);
    const out = Number(row.output_cost_per_token);
    if (!Number.isFinite(inn) || !Number.isFinite(out)) continue;
    index[key.toLowerCase()] = { inPerM: inn * 1e6, outPerM: out * 1e6 };
  }
  return index;
}

/**
 * @param {string} atomId
 * @param {Record<string, { inPerM: number, outPerM: number }>} index
 * @returns {PriceRate | null}
 */
export function lookupCloudPrice(atomId, index) {
  const { provider, part } = parseAtomModelId(atomId);
  if (!provider || !part || !index) return null;
  const partLower = part.toLowerCase();
  const prefixes = PROVIDER_PREFIXES[provider] ?? [`${provider}/`];

  for (const p of prefixes) {
    const k = `${p}${partLower}`;
    if (index[k]) return { ...index[k], catalogId: k };
  }

  const allowed = (k) => prefixes.some((p) => p && k.startsWith(p));
  const suffix = `/${partLower}`;
  const samePath = Object.keys(index).filter((k) => allowed(k) && k.endsWith(suffix));
  if (samePath[0]) return { ...index[samePath[0]], catalogId: samePath[0] };

  const partTail = partLower.split('/').pop() || partLower;
  const loose = Object.keys(index).filter((k) => {
    if (!allowed(k)) return false;
    const tail = k.split('/').pop() || k;
    return tail === partTail || tail.endsWith(partTail) || partTail.endsWith(tail);
  });
  if (!loose.length) return null;
  loose.sort((a, b) => a.length - b.length);
  return { ...index[loose[0]], catalogId: loose[0] };
}

export function formatUsdPerMillion(n) {
  if (n == null || !Number.isFinite(n)) return null;
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  if (abs < 0.01) return `$${n.toFixed(4)}`.replace(/0+$/, '').replace(/\.$/, '');
  if (abs < 1) return `$${n.toFixed(3)}`.replace(/0+$/, '').replace(/\.$/, '');
  return `$${n.toFixed(2)}`;
}

/**
 * @param {string} atomId
 * @param {ModelPricingState} [state]
 */
export function formatPriceLine(atomId, state) {
  const st = state ?? get(modelPricing);
  if (isLocalModelId(atomId)) return 'this device · $0';
  const rate = st.rates?.[atomId];
  if (!rate) return null;
  const inn = formatUsdPerMillion(rate.inPerM);
  const out = formatUsdPerMillion(rate.outPerM);
  if (!inn || !out) return null;
  return `${inn} in · ${out} out /1M`;
}

export function formatPricingFetchedAt(fetchedAt) {
  if (!fetchedAt) return null;
  try {
    return new Date(fetchedAt).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

/**
 * Recompute per-model rates for the current selector ids from the last catalog.
 * @param {{ id: string }[] | string[]} models
 */
export function applyPricingToModels(models) {
  const ids = (models ?? [])
    .map((m) => (typeof m === 'string' ? m : m?.id))
    .filter((id) => typeof id === 'string' && id);
  /** @type {Record<string, PriceRate>} */
  const rates = {};
  if (catalogIndex) {
    for (const id of ids) {
      if (isLocalModelId(id)) continue;
      const hit = lookupCloudPrice(id, catalogIndex);
      if (hit) rates[id] = hit;
    }
  }
  modelPricing.update((s) => ({ ...s, rates }));
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

/**
 * Pull current catalog prices. Safe to call more than once; concurrent calls share one request.
 * @returns {Promise<boolean>}
 */
export async function refreshModelPricing() {
  if (inflight) return inflight;
  inflight = (async () => {
    modelPricing.update((s) => ({ ...s, status: 'loading', error: null }));
    const urls = [LOCAL_PRICE_URL, LITELLM_PRICE_URL];
    let lastErr = /** @type {unknown} */ (null);
    for (const url of urls) {
      try {
        const data = await fetchJson(url);
        const table =
          data && typeof data === 'object' && data.data && typeof data.data === 'object' && !Array.isArray(data.data)
            ? data.data
            : data;
        catalogIndex = indexLiteLLMTable(/** @type {Record<string, unknown>} */ (table));
        const count = Object.keys(catalogIndex).length;
        if (count === 0) throw new Error('empty catalog');
        applyPricingToModels(get(models));
        modelPricing.update((s) => ({
          ...s,
          status: 'ready',
          fetchedAt: Date.now(),
          source: url === LOCAL_PRICE_URL ? 'litellm (proxy)' : 'litellm',
          error: null,
        }));
        return true;
      } catch (e) {
        lastErr = e;
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : 'price fetch failed';
    modelPricing.update((s) => ({ ...s, status: 'error', error: msg }));
    return false;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
