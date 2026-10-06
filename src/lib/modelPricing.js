/**
 * Live model list prices for the selector. OpenRouter's public catalog
 * (in/out/cache per token → displayed per 1M) is fetched again whenever the
 * app loads or the window becomes visible, not only when the dropdown is
 * opened by hand. Local GGUFs are $0. Nothing is persisted across restarts.
 */
import { get, writable } from 'svelte/store';
import { cloudModelPart } from '$lib/cloudCatalog.js';

const PROVIDER_OPENROUTER_PREFIX = {
  grok: 'x-ai',
  deepseek: 'deepseek',
  cerebras: 'cerebras',
};

export const modelPricingCatalog = writable({
  status: 'idle',
  /** @type {null | { byId: Map<string, object>, bySuffix: Map<string, string[]> }} */
  index: null,
  /** @type {null | Map<string, { inPerM: number, outPerM: number, cachePerM: number|null, context: number|null, id: string }>} */
  deepinfra: null,
  fetchedAt: 0,
  error: '',
});

let inflight = null;
let inflightIsForce = false;

function catalogUrls() {
  const direct = 'https://openrouter.ai/api/v1/models';
  const proxied = '/api/openrouter/api/v1/models';
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return [proxied, direct];
  return [direct];
}

function deepinfraUrls() {
  const direct = 'https://api.deepinfra.com/v1/models';
  const proxied = '/api/deepinfra/v1/models';
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return [proxied, direct];
  return [direct];
}

function perMillionOrNull(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e6) / 1e6;
}

/** DeepInfra lists dollars per 1M tokens under metadata.pricing, not per-token. */
export function buildDeepInfraIndex(models) {
  const byId = new Map();
  for (const m of Array.isArray(models) ? models : []) {
    const id = typeof m?.id === 'string' ? m.id : '';
    const pricing = m?.metadata?.pricing;
    if (!id || !pricing) continue;
    const inn = perMillionOrNull(pricing.input_tokens);
    const out = perMillionOrNull(pricing.output_tokens);
    if (inn == null || out == null) continue;
    byId.set(normalizeModelKey(id), {
      inPerM: inn,
      outPerM: out,
      cachePerM: perMillionOrNull(pricing.cache_read_tokens),
      context: Number(m.context_length) || null,
      id,
    });
  }
  return byId;
}

export function normalizeModelKey(id) {
  return String(id || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
}

export function isLocalAtomModel(atomId) {
  if (!atomId || typeof atomId !== 'string') return true;
  return atomId.indexOf(':') === -1;
}

export function openRouterMatchCandidates(atomId) {
  if (!atomId || typeof atomId !== 'string') return [];
  const colon = atomId.indexOf(':');
  const provider = colon > 0 ? atomId.slice(0, colon).toLowerCase() : '';
  const part = (colon > 0 ? atomId.slice(colon + 1) : atomId).trim();
  const out = [];
  const add = (s) => {
    const t = String(s || '').trim();
    if (t) out.push(normalizeModelKey(t));
  };
  add(part);
  const pref = PROVIDER_OPENROUTER_PREFIX[provider];
  if (pref) {
    add(`${pref}/${part}`);
    if (part.includes('/')) add(`${pref}/${part.slice(part.indexOf('/') + 1)}`);
  }
  return [...new Set(out)];
}

export function buildOpenRouterIndex(models) {
  const list = Array.isArray(models) ? models : [];
  const byId = new Map();
  const bySuffix = new Map();
  for (const m of list) {
    const id = typeof m?.id === 'string' ? m.id : '';
    if (!id) continue;
    const key = normalizeModelKey(id);
    byId.set(key, m);
    const suf = key.split('/').pop();
    if (!suf) continue;
    const arr = bySuffix.get(suf) || [];
    arr.push(key);
    bySuffix.set(suf, arr);
  }
  return { byId, bySuffix };
}

export function matchOpenRouterModel(atomId, index) {
  if (!index?.byId) return null;
  for (const c of openRouterMatchCandidates(atomId)) {
    const hit = index.byId.get(c);
    if (hit) return hit;
  }
  const suffix = normalizeModelKey(cloudModelPart(atomId) || atomId).split('/').pop();
  const ids = suffix ? index.bySuffix.get(suffix) : null;
  if (ids?.length === 1) return index.byId.get(ids[0]) || null;
  return null;
}

export function perTokenToPerMillion(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n * 1e6;
}

export function formatUsdPerMillion(perM) {
  if (perM == null || !Number.isFinite(perM)) return null;
  if (perM === 0) return 'Free';
  const abs = Math.abs(perM);
  if (abs >= 10) return `$${perM.toFixed(2)}`;
  if (abs >= 1) return `$${perM.toFixed(2)}`;
  if (abs >= 0.1) return `$${perM.toFixed(3)}`;
  if (abs >= 0.01) return `$${perM.toFixed(3)}`;
  return `$${perM.toFixed(4)}`;
}

export function formatContextTokens(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M ctx`;
  }
  if (v >= 1000) return `${Math.round(v / 1000)}K ctx`;
  return `${Math.round(v)} ctx`;
}

/**
 * @returns {{
 *   source: 'local' | 'openrouter' | 'deepinfra' | 'unknown',
 *   inPerM: number | null,
 *   outPerM: number | null,
 *   cachePerM: number | null,
 *   context: number | null,
 *   openRouterId: string | null,
 * }}
 */
function unknownPrice() {
  return {
    source: 'unknown',
    inPerM: null,
    outPerM: null,
    cachePerM: null,
    context: null,
    openRouterId: null,
  };
}

export function lookupPricing(atomId, catalog) {
  if (isLocalAtomModel(atomId)) {
    return {
      source: 'local',
      inPerM: 0,
      outPerM: 0,
      cachePerM: 0,
      context: null,
      openRouterId: null,
    };
  }
  const colon = String(atomId).indexOf(':');
  const provider = colon > 0 ? String(atomId).slice(0, colon).toLowerCase() : '';
  if (provider === 'deepinfra') {
    const part = String(atomId).slice(colon + 1);
    const hit = catalog?.deepinfra?.get?.(normalizeModelKey(part));
    if (!hit) return unknownPrice();
    return {
      source: 'deepinfra',
      inPerM: hit.inPerM,
      outPerM: hit.outPerM,
      cachePerM: hit.cachePerM,
      context: hit.context ?? null,
      openRouterId: null,
    };
  }
  const hit = matchOpenRouterModel(atomId, catalog?.index);
  if (!hit) return unknownPrice();
  const p = hit.pricing || {};
  return {
    source: 'openrouter',
    inPerM: perTokenToPerMillion(p.prompt),
    outPerM: perTokenToPerMillion(p.completion),
    cachePerM: perTokenToPerMillion(p.input_cache_read),
    context: Number(hit.context_length) || null,
    openRouterId: hit.id || null,
  };
}

export function formatPriceTriple(info) {
  if (!info || info.source === 'unknown') return 'In ? · Out ? · Cache ?';
  const inn = formatUsdPerMillion(info.inPerM) ?? '?';
  const out = formatUsdPerMillion(info.outPerM) ?? '?';
  const cache = info.cachePerM == null ? '—' : formatUsdPerMillion(info.cachePerM) ?? '—';
  return `In ${inn} · Out ${out} · Cache ${cache}`;
}

export function pricingSearchText(atomId, catalog) {
  const info = lookupPricing(atomId, catalog);
  const bits = [formatPriceTriple(info), formatContextTokens(info.context), info.openRouterId];
  return bits.filter(Boolean).join(' ');
}

function firstFiniteNumber(...vals) {
  for (const raw of vals) {
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Cached-token figure already returned by the API. Null when the payload has
 * no cache field (callers show 0 — they must not estimate a cache hit).
 * OpenAI cached_tokens is a subset of prompt_tokens, so it is not added to
 * prompt+completion.
 * @param {object|null|undefined} source usage object or message stats
 * @returns {number|null}
 */
export function readCachedTokenCount(source) {
  if (!source || typeof source !== 'object') return null;
  const promptDetails = source.prompt_tokens_details;
  const inputDetails = source.input_tokens_details;
  return firstFiniteNumber(
    promptDetails && typeof promptDetails === 'object' ? promptDetails.cached_tokens : undefined,
    inputDetails && typeof inputDetails === 'object' ? inputDetails.cached_tokens : undefined,
    source.cached_tokens,
    source.prompt_cache_hit_tokens,
    source.cache_read_input_tokens,
  );
}

/**
 * Map OpenAI / Grok / DeepInfra usage blobs onto prompt_tokens + completion_tokens.
 * Returns null when the payload has no token counts at all.
 * @param {object|null|undefined} usage
 * @returns {{ prompt_tokens?: number, completion_tokens?: number, cached_tokens?: number }|null}
 */
export function normalizeChatUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = firstFiniteNumber(
    usage.prompt_tokens,
    usage.input_tokens,
    usage.prompt_token_count,
    usage.promptTokens,
  );
  const completion = firstFiniteNumber(
    usage.completion_tokens,
    usage.output_tokens,
    usage.completion_token_count,
    usage.completionTokens,
  );
  const cached = readCachedTokenCount(usage);
  if (prompt == null && completion == null && cached == null) return null;
  const out = { ...usage };
  if (prompt != null) out.prompt_tokens = prompt;
  if (completion != null) out.completion_tokens = completion;
  if (cached != null) out.cached_tokens = cached;
  return out;
}

/** Char/4 estimate only when the API omitted completion_tokens. Empty text is 0, not 1. */
export function estimateCompletionTokens(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

/**
 * Stats object stored on an assistant message. Prefers API usage; estimates
 * completion from visible text only when the stream never reported it.
 * @param {object|null|undefined} usage
 * @param {string} [content]
 * @param {object} [extra]
 */
export function assistantStatsFromUsage(usage, content = '', extra = {}) {
  const norm = normalizeChatUsage(usage);
  const completion = norm?.completion_tokens != null
    ? norm.completion_tokens
    : estimateCompletionTokens(content);
  const stats = {
    prompt_tokens: norm?.prompt_tokens ?? 0,
    completion_tokens: completion,
    estimated: norm?.completion_tokens == null,
    ...extra,
  };
  const cached = readCachedTokenCount(norm || usage);
  if (cached != null) stats.cached_tokens = cached;
  const promptDetails = (norm || usage)?.prompt_tokens_details;
  if (promptDetails && typeof promptDetails === 'object') {
    stats.prompt_tokens_details = promptDetails;
  }
  const inputDetails = (norm || usage)?.input_tokens_details;
  if (inputDetails && typeof inputDetails === 'object') {
    stats.input_tokens_details = inputDetails;
  }
  return stats;
}

/**
 * Sum prompt + completion tokens already stored on assistant messages.
 * Cache is summed separately and is not added into total (it is part of input
 * when the API reports it). Missing cache fields count as 0, not an estimate.
 * Does not estimate tokens that were never recorded.
 * @param {Array<{ role?: string, stats?: { prompt_tokens?: number, completion_tokens?: number, cached_tokens?: number, prompt_tokens_details?: { cached_tokens?: number }, prompt_cache_hit_tokens?: number, cache_read_input_tokens?: number, estimated?: boolean } }>|null|undefined} messages
 */
export function sumAssistantUsage(messages) {
  let prompt = 0;
  let completion = 0;
  let cached = 0;
  let saw = false;
  let estimated = false;
  for (const m of messages || []) {
    if (!m || m.role !== 'assistant' || !m.stats) continue;
    const p = Number(m.stats.prompt_tokens);
    const c = Number(m.stats.completion_tokens);
    if (Number.isFinite(p)) {
      prompt += p;
      saw = true;
    }
    if (Number.isFinite(c)) {
      completion += c;
      saw = true;
    }
    const hit = readCachedTokenCount(m.stats);
    if (hit != null) cached += hit;
    if (m.stats.estimated) estimated = true;
  }
  return { prompt, completion, cached, total: prompt + completion, saw, estimated };
}

/**
 * Arena cumulative footer. Total is prompt + completion only.
 * Exact shape: `{total} tok[~] (in {prompt} · out {completion} · cache {cached}) · {cost}`
 * @param {{ total?: number, prompt?: number, completion?: number, cached?: number, estimated?: boolean, priceKnown?: boolean, cost?: number|null }} usage
 */
export function formatArenaUsageFooter(usage) {
  const u = usage || {};
  const tok = `${formatTokenCount(u.total)} tok`;
  const split = `in ${formatTokenCount(u.prompt)} · out ${formatTokenCount(u.completion)} · cache ${formatTokenCount(u.cached)}`;
  const cost = u.priceKnown ? formatRunningUsd(u.cost) : 'cost unknown';
  const est = u.estimated ? ' ~' : '';
  return `${tok}${est} (${split}) · ${cost}`;
}

/**
 * Dollar cost from existing per-1M rates. Returns null when the catalog has no price
 * (caller should say cost is unknown — never invent a rate).
 * Cached tokens are a subset of prompt tokens: billed at cachePerM when known,
 * otherwise at the regular input rate.
 * @param {number} promptTokens
 * @param {number} completionTokens
 * @param {{ source?: string, inPerM?: number|null, outPerM?: number|null, cachePerM?: number|null }|null} info
 * @param {number} [cachedTokens]
 * @returns {number|null}
 */
export function runningCostUsd(promptTokens, completionTokens, info, cachedTokens = 0) {
  if (!info || info.source === 'unknown') return null;
  if (info.inPerM == null || info.outPerM == null) return null;
  if (!Number.isFinite(info.inPerM) || !Number.isFinite(info.outPerM)) return null;
  const p = Number(promptTokens) || 0;
  const c = Number(completionTokens) || 0;
  const cached = Math.min(Math.max(0, Number(cachedTokens) || 0), p);
  const uncached = p - cached;
  const cacheRate = info.cachePerM != null && Number.isFinite(info.cachePerM)
    ? info.cachePerM
    : info.inPerM;
  return (uncached * info.inPerM + cached * cacheRate + c * info.outPerM) / 1e6;
}

/** Absolute USD for a running total (not the $/1M selector format). */
export function formatRunningUsd(amount) {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (amount === 0) return '$0.00';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  return `${sign}$${abs.toFixed(6)}`;
}

export function formatTokenCount(n) {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return safe.toLocaleString('en-US');
}

/**
 * @param {{ force?: boolean }} [opts]
 * force: refetch even when a catalog is already in memory (app open / window visible).
 * Concurrent callers share one request. A failed refresh keeps the previous index.
 */
export async function ensureModelPricing(opts = {}) {
  const force = !!opts?.force;
  const cur = get(modelPricingCatalog);
  if (!force && cur?.status === 'ready' && cur.index) return cur;
  if (inflight) {
    if (!force || inflightIsForce) return inflight;
    try {
      await inflight;
    } catch {
      /* the in-flight call records its own error */
    }
    return ensureModelPricing({ force: true });
  }
  inflightIsForce = force;
  inflight = (async () => {
    const previous = get(modelPricingCatalog);
    modelPricingCatalog.update((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      let lastErr = null;
      let rows = [];
      for (const url of catalogUrls()) {
        try {
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) {
            lastErr = new Error(`Pricing catalog ${res.status}`);
            continue;
          }
          const data = await res.json();
          rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
          if (rows.length) break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!rows.length) throw lastErr || new Error('Pricing catalog empty');
      const index = buildOpenRouterIndex(rows);
      let deepinfra = new Map();
      for (const url of deepinfraUrls()) {
        try {
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!res.ok) continue;
          const data = await res.json();
          const list = Array.isArray(data?.data) ? data.data : [];
          if (!list.length) continue;
          deepinfra = buildDeepInfraIndex(list);
          break;
        } catch {
          /* OpenRouter prices still stand if DeepInfra is down */
        }
      }
      const next = { status: 'ready', index, deepinfra, fetchedAt: Date.now(), error: '' };
      modelPricingCatalog.set(next);
      return next;
    } catch (e) {
      if (previous?.index) {
        const next = {
          status: 'ready',
          index: previous.index,
          deepinfra: previous.deepinfra || null,
          fetchedAt: previous.fetchedAt || 0,
          error: e?.message || 'Could not load prices',
        };
        modelPricingCatalog.set(next);
        return next;
      }
      const next = {
        status: 'error',
        index: null,
        deepinfra: null,
        fetchedAt: 0,
        error: e?.message || 'Could not load prices',
      };
      modelPricingCatalog.set(next);
      return next;
    } finally {
      inflight = null;
      inflightIsForce = false;
    }
  })();
  return inflight;
}
