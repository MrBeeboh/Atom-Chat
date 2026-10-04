/**
 * Startup funding check for cloud providers Atom already knows.
 * The result lives in memory for this page only. A reload checks again.
 * Nothing is written to localStorage or any other disk cache.
 */
import { writable } from 'svelte/store';

/** @type {Record<string, boolean> | null} */
let sessionFunded = null;
/** @type {string[]} */
let knownProviders = [];

export function resetProviderFundingSession() {
  sessionFunded = null;
  knownProviders = [];
}

/**
 * @param {Record<string, boolean>} map
 * @param {string[]} providerIds
 */
export function setStartupFunding(map, providerIds) {
  sessionFunded = map && typeof map === 'object' ? map : {};
  knownProviders = Array.isArray(providerIds) ? providerIds.slice() : [];
}

export function startupFundingSnapshot() {
  return sessionFunded ? { ...sessionFunded } : null;
}

/**
 * Prefix only when it is one of the app's cloud provider ids.
 * Local ids, including GGUF paths, are not providers.
 * @param {string} modelId
 */
export function cloudProviderIdOf(modelId) {
  if (!modelId || typeof modelId !== 'string') return '';
  const i = modelId.indexOf(':');
  if (i <= 0) return '';
  const prefix = modelId.slice(0, i);
  return knownProviders.includes(prefix) ? prefix : '';
}

/**
 * Local models stay eligible. A cloud model is eligible only after this
 * startup's check marked its provider funded. Before the check runs, cloud
 * rows are left alone so unit fixtures are not stripped.
 * @param {string} modelId
 */
export function isArenaModelEligible(modelId) {
  const provider = cloudProviderIdOf(modelId);
  if (!provider) return true;
  if (!sessionFunded) return true;
  return sessionFunded[provider] === true;
}

/**
 * Balance endpoints the provider documents, called with the key Atom already
 * stores. Grok's prepaid balance needs a separate management key this app
 * does not have. Cerebras and Nous do not expose a balance route for the
 * inference key Atom stores, so those three use the models list instead.
 * @param {string} providerId
 * @param {{ dev?: boolean, modelsUrl?: string }} opts
 */
const MODEL_URLS = {
  deepseek: ['/api/deepseek/v1/models', 'https://api.deepseek.com/v1/models'],
  deepinfra: ['/api/deepinfra/v1/openai/models', 'https://api.deepinfra.com/v1/openai/models'],
  grok: ['/api/xai/v1/models', 'https://api.x.ai/v1/models'],
  cerebras: ['/api/cerebras/v1/models', 'https://api.cerebras.ai/v1/models'],
  nous: ['/api/nous/v1/models', 'https://inference-api.nousresearch.com/v1/models'],
};

/**
 * One inquiry per provider: the models list the app can already call.
 * That response is also the funding signal (auth, billing, timeout) and the
 * only price source. Balance routes are not called in addition.
 * @param {string} providerId
 * @param {{ dev?: boolean, modelsUrl?: string }} opts
 */
export function fundingProbe(providerId, { dev = false, modelsUrl = '' } = {}) {
  const pair = MODEL_URLS[providerId];
  const fallback = pair ? pair[dev ? 0 : 1] : '';
  return { kind: 'models', url: modelsUrl || fallback };
}

const BILLING_FAIL = /insufficient[_\s-]?credit|insufficient[_\s-]?quota|payment required|out of credits|credit balance|no credits|exceeded your current quota|billing/i;

/**
 * @param {string} providerId
 * @param {{ timedOut?: boolean, status?: number, body?: object|null, bodyText?: string }} res
 * @returns {{ funded: boolean, reason: string }}
 */
export function decideFunded(providerId, { timedOut = false, status = 0, body = null, bodyText = '' } = {}) {
  if (timedOut) return { funded: false, reason: 'timeout' };
  const text = typeof bodyText === 'string' ? bodyText : '';
  if (status === 401 || status === 403) return { funded: false, reason: 'auth' };
  if (status === 402 || (status !== 200 && status !== 201 && BILLING_FAIL.test(text))) {
    return { funded: false, reason: 'billing' };
  }
  if (status < 200 || status >= 300) return { funded: false, reason: status ? `http-${status}` : 'network' };
  if (body && typeof body.is_available === 'boolean') {
    return { funded: body.is_available === true, reason: body.is_available ? 'balance' : 'balance-empty' };
  }
  if (body && (Object.prototype.hasOwnProperty.call(body, 'stripe_balance') || body.suspended === true || body.suspend_reason)) {
    return decideDeepinfra(body);
  }
  if (Array.isArray(body?.data) || Array.isArray(body?.models) || Array.isArray(body)) {
    return { funded: true, reason: 'models-ok' };
  }
  if (providerId === 'deepseek') return { funded: false, reason: 'balance-empty' };
  return { funded: false, reason: 'unreadable' };
}

function decideDeepinfra(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { funded: false, reason: 'balance-unreadable' };
  }
  if (body.suspended === true || body.suspend_reason) {
    return { funded: false, reason: 'suspended' };
  }
  const credits = Array.isArray(body.scoped_credits) ? body.scoped_credits : [];
  if (credits.some((c) => c && !c.expired && Number(c.remaining_cents) > 0)) {
    return { funded: true, reason: 'scoped-credit' };
  }
  const bal = Number(body.stripe_balance);
  if (Number.isFinite(bal) && bal < 0) return { funded: true, reason: 'prepaid' };
  const limit = body.limit == null || body.limit === '' ? null : Number(body.limit);
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    return { funded: true, reason: 'spending-limit' };
  }
  if (!Number.isFinite(bal)) return { funded: false, reason: 'balance-unreadable' };
  return { funded: false, reason: 'no-funds' };
}


/** Comparison-page rows for this page load. Not written to disk. */
export const providerStartupReport = writable([]);

function modelRows(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.models)) return body.models;
  return [];
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Prices present on this response only. Missing fields stay absent.
 * Nous lists per-token rates. DeepInfra metadata.pricing.input_tokens is USD per 1M.
 * @param {object|array|null} body
 */
export function extractProviderPrices(body) {
  const out = [];
  for (const row of modelRows(body)) {
    if (!row || typeof row !== 'object') continue;
    const id = typeof row.id === 'string' ? row.id : (typeof row.name === 'string' ? row.name : '');
    if (!id) continue;
    const perToken = row.pricing;
    if (perToken && typeof perToken === 'object' && (perToken.prompt != null || perToken.completion != null)) {
      const inn = num(perToken.prompt);
      const outp = num(perToken.completion);
      if (inn == null && outp == null) continue;
      out.push({
        id,
        inPerM: inn == null ? null : inn * 1e6,
        outPerM: outp == null ? null : outp * 1e6,
        unit: 'usd_per_million',
        rawUnit: 'per_token',
      });
      continue;
    }
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata.pricing : null;
    if (meta && typeof meta === 'object' && (meta.input_tokens != null || meta.output_tokens != null)) {
      out.push({
        id,
        inPerM: num(meta.input_tokens),
        outPerM: num(meta.output_tokens),
        unit: 'usd_per_million',
        rawUnit: 'metadata.pricing per 1M tokens',
      });
    }
  }
  return out;
}

export function modelIdsFromBody(body) {
  const ids = [];
  const seen = new Set();
  for (const row of modelRows(body)) {
    const id = typeof row === 'string' ? row : (row?.id || row?.name);
    if (typeof id !== 'string' || !id.trim()) continue;
    const key = id.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id.trim());
  }
  return ids;
}

/**
 * @param {{ id: string, name?: string, hasKey: boolean, timedOut?: boolean, status?: number, body?: object|null, bodyText?: string, prior?: object|null }} input
 */
export function buildProviderCheckRow(input) {
  const id = input.id;
  const name = input.name || id;
  const prior = input.prior && input.prior.id === id ? input.prior : null;
  if (!input.hasKey) {
    return {
      id,
      name,
      funded: false,
      fundingState: 'error',
      priceState: 'error',
      error: `${name} check failed: no saved API key`,
      prices: [],
      modelIds: [],
    };
  }
  const status = input.status || 0;
  const failed = input.timedOut || status < 200 || status >= 300;
  if (failed) {
    const why = input.timedOut ? 'timed out' : status ? `HTTP ${status}` : 'network error';
    const error = `${name} check failed: ${why}`;
    const answered = status === 401 || status === 403 || status === 402;
    if (!answered && prior && Array.isArray(prior.prices) && prior.prices.length) {
      return {
        ...prior,
        id,
        name,
        fundingState: 'stale',
        priceState: 'stale',
        error: `${error}. Showing the last in-memory result from this page.`,
      };
    }
    return {
      id,
      name,
      funded: false,
      fundingState: answered ? 'fresh' : 'error',
      priceState: 'error',
      error,
      prices: [],
      modelIds: [],
    };
  }
  const decision = decideFunded(id, { status, body: input.body, bodyText: input.bodyText || '' });
  const prices = extractProviderPrices(input.body);
  const modelIds = modelIdsFromBody(input.body);
  if (!prices.length) {
    return {
      id,
      name,
      funded: decision.funded,
      fundingState: 'fresh',
      priceState: 'stale',
      error: `${name} price missing from the models response`,
      prices: [],
      modelIds,
    };
  }
  return {
    id,
    name,
    funded: decision.funded,
    fundingState: 'fresh',
    priceState: 'fresh',
    error: '',
    prices,
    modelIds,
  };
}

export function providerStatusText(row) {
  if (!row) return '';
  if (row.fundingState === 'error' && row.priceState === 'error') return row.error || `${row.name} check failed`;
  const fund = row.funded ? 'funded' : 'not funded';
  const head = `${row.name} — ${fund} (${row.fundingState})`;
  if (row.priceState === 'fresh') return `${head} — ${row.prices.length} model prices fresh`;
  if (row.priceState === 'stale') return `${head} — price stale: ${row.error || 'no price in the response'}`;
  return `${head} — ${row.error || 'pricing check failed'}`;
}

export function startupPriceFor(modelId, rows) {
  if (!modelId || typeof modelId !== 'string') return null;
  const i = modelId.indexOf(':');
  if (i <= 0) return null;
  const providerId = modelId.slice(0, i);
  const part = modelId.slice(i + 1);
  const row = (rows || []).find((r) => r.id === providerId);
  if (!row) return null;
  const hit = (row.prices || []).find((p) => p.id === part);
  return { row, hit: hit || null };
}

/** Anonymous column: hide the model name only. The answer is not part of this flag. */
export function assistantShowsModelName(modelLabel, hideModelName) {
  return Boolean(modelLabel) && hideModelName !== true;
}
