/**
 * Arena context-usage safety net for local llama.cpp contestants.
 *
 * After each local contestant answer, compare what the model's KV slot holds
 * (prompt + answer tokens) with that slot's n_ctx. At or above
 * ARENA_CONTEXT_WIPE_THRESHOLD, clear the slot in place before the next question.
 * Never unloads or reloads the model (a reload costs 20–40 s).
 *
 * How the clear works, through the same base URL the browser chat uses
 * (dev: /api/llama → :8080 proxy → llama.cpp router → model child):
 *   1. POST /slots/{id}?action=erase&autoload=false  body {model}
 *      The built-in erase. llama-server only allows it when the child runs with
 *      --slot-save-path (otherwise HTTP 501 not_supported).
 *   2. On 501: POST /completion?autoload=false  body {model, prompt:".", n_predict:1,
 *      cache_prompt:false, id_slot}. With cache_prompt off the server drops the slot's
 *      KV from position 0 and leaves only the 1-token prompt, which is an in-place reset.
 * n_ctx and the slot fill come from GET /slots?model=…&autoload=false (n_ctx,
 * n_prompt_tokens = tokens currently held by the slot). If /slots fails, n_ctx falls back
 * to the --ctx-size arg in GET /models. autoload=false on every call means the guard
 * can never make the router load a model.
 *
 * Every call is best-effort: short timeout, errors caught, console.warn on failure.
 * Nothing runs per token: there is at most one GET /slots per answer, and none when
 * the cached n_ctx already shows the answer is below the threshold.
 */
import { getLmStudioBase, joinUrl, normalizeLocalLmBaseUrl } from '$lib/apiConfig.js';
import { isQwen38FlashNextSelection } from '$lib/modelIdUtils.js';
import { FLASH_NEXT_CHAT_BASE } from '$lib/flashNext.js';

/** Wipe when (slot tokens) / n_ctx reaches this fraction. */
export const ARENA_CONTEXT_WIPE_THRESHOLD = 0.75;
/** Never wipe a slot already at or below this fraction of n_ctx (nothing to gain). */
export const ARENA_CONTEXT_NEAR_EMPTY_RATIO = 0.05;
/** Per-request timeout for every guard HTTP call. */
export const ARENA_CONTEXT_GUARD_TIMEOUT_MS = 2500;
/** Same fallback as streamChatCompletion when max_tokens is unset/invalid. */
const DEFAULT_MAX_TOKENS = 4096;
/** Rough per-image token estimate for the pre-flight projection. */
const IMAGE_TOKEN_ESTIMATE = 1024;

/** Same rule as arenaLogic.isCloudModel: cloud/API ids are "provider:model". */
export function isGuardableLocalModel(modelId) {
  return typeof modelId === 'string' && modelId.trim() !== '' && !modelId.includes(':');
}

function posInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** (prompt + completion) / nCtx, or null when nCtx is unknown. */
export function contextUsageRatio(promptTokens, completionTokens, nCtx) {
  const ctx = posInt(nCtx);
  if (!ctx) return null;
  const used = Math.max(0, Number(promptTokens) || 0) + Math.max(0, Number(completionTokens) || 0);
  return used / ctx;
}

/**
 * Token totals from an OpenAI usage object, else llama.cpp `timings`
 * (prompt_n + cache_n prompt tokens, predicted_n answer tokens).
 * @returns {{ prompt: number, completion: number, total: number } | null}
 */
export function usageTokens(usage, timings) {
  const p = Number(usage?.prompt_tokens);
  const c = Number(usage?.completion_tokens);
  if (Number.isFinite(p) && p >= 0 && Number.isFinite(c) && c >= 0 && p + c > 0) {
    return { prompt: p, completion: c, total: p + c };
  }
  if (timings && typeof timings === 'object') {
    const tp = (Number(timings.prompt_n) || 0) + (Number(timings.cache_n) || 0);
    const tc = Number(timings.predicted_n) || 0;
    if (tp + tc > 0) return { prompt: tp, completion: tc, total: tp + tc };
  }
  return null;
}

/**
 * Pure wipe decision.
 * @param {{ fill: number, nCtx: number, extraTokens?: number, threshold?: number, nearEmptyRatio?: number }} o
 *   fill: tokens the slot holds now. extraTokens: pre-flight projection (prompt estimate + max_tokens).
 * @returns {{ wipe: boolean, why: string, ratio: number|null, projectedRatio: number|null }}
 */
export function decideWipe({
  fill,
  nCtx,
  extraTokens = 0,
  threshold = ARENA_CONTEXT_WIPE_THRESHOLD,
  nearEmptyRatio = ARENA_CONTEXT_NEAR_EMPTY_RATIO,
} = {}) {
  const ctx = posInt(nCtx);
  const f = Math.max(0, Number(fill) || 0);
  if (!ctx) return { wipe: false, why: 'unknown-n_ctx', ratio: null, projectedRatio: null };
  const ratio = f / ctx;
  const projectedRatio = (f + Math.max(0, Number(extraTokens) || 0)) / ctx;
  if (ratio <= nearEmptyRatio) return { wipe: false, why: 'near-empty', ratio, projectedRatio };
  if (projectedRatio >= threshold) return { wipe: true, why: 'over-threshold', ratio, projectedRatio };
  return { wipe: false, why: 'below-threshold', ratio, projectedRatio };
}

/** Rough prompt-size estimate (chars / 4, images at a flat estimate). */
export function estimatePromptTokens(messages) {
  let chars = 0;
  let images = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    const c = m?.content;
    if (typeof c === 'string') chars += c.length;
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (part?.type === 'text' && typeof part.text === 'string') chars += part.text.length;
        else if (part?.type === 'image_url' || part?.type === 'image') images += 1;
      }
    }
  }
  return Math.ceil(chars / 4) + images * IMAGE_TOKEN_ESTIMATE;
}

/** Base URL for a local model: the Flash-Next sidecar or the configured router/proxy base. */
export function guardBaseForModel(base, modelId) {
  if (isQwen38FlashNextSelection(modelId)) return FLASH_NEXT_CHAT_BASE;
  return normalizeLocalLmBaseUrl(base);
}

export function buildSlotsUrl(base, modelId) {
  const q = `model=${encodeURIComponent(modelId)}&autoload=false`;
  return `${joinUrl(guardBaseForModel(base, modelId), 'slots')}?${q}`;
}

export function buildModelsUrl(base) {
  return joinUrl(normalizeLocalLmBaseUrl(base), 'models');
}

/** Built-in slot erase. The router routes POSTs by the JSON body's `model`. */
export function buildEraseRequest(base, modelId, slotId = 0) {
  const id = Number.isInteger(slotId) && slotId >= 0 ? slotId : 0;
  return {
    url: `${joinUrl(guardBaseForModel(base, modelId), `slots/${id}`)}?action=erase&autoload=false`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId }),
    },
  };
}

/** Fallback in-place reset (no --slot-save-path): 1-token prompt with cache_prompt off, pinned to the slot. */
export function buildResetRequest(base, modelId, slotId = 0) {
  const id = Number.isInteger(slotId) && slotId >= 0 ? slotId : 0;
  return {
    url: `${joinUrl(guardBaseForModel(base, modelId), 'completion')}?autoload=false`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        prompt: '.',
        n_predict: 1,
        cache_prompt: false,
        id_slot: id,
        stream: false,
      }),
    },
  };
}

/** --ctx-size / -c from a router /models row's status.args. */
export function ctxSizeFromModelsPayload(data, modelId) {
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  const want = String(modelId || '').trim().toLowerCase();
  for (const m of rows) {
    const id = String(m?.id ?? m?.name ?? m?.model ?? '').trim().toLowerCase();
    if (!id || id !== want) continue;
    const meta = posInt(m?.meta?.n_ctx);
    if (meta) return meta;
    const args = m?.status?.args;
    if (!Array.isArray(args)) return 0;
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === '--ctx-size' || args[i] === '-c') return posInt(args[i + 1]);
    }
    return 0;
  }
  return 0;
}

/** Slot rows from GET /slots: id, n_ctx, tokens held, busy flag. */
export function parseSlots(data) {
  if (!Array.isArray(data)) return null;
  return data
    .filter((s) => s && typeof s === 'object')
    .map((s, i) => {
      const processing = s.is_processing === true;
      const decoded = processing ? Number(s.next_token?.[0]?.n_decoded) || 0 : 0;
      return {
        id: Number.isInteger(s.id) ? s.id : i,
        nCtx: posInt(s.n_ctx),
        fill: Math.max(0, Number(s.n_prompt_tokens) || 0) + decoded,
        processing,
      };
    });
}

function shortModel(modelId) {
  const s = String(modelId || '');
  const leaf = s.split(/[\\/]/).pop() || s;
  return leaf.replace(/\.gguf$/i, '');
}

export function formatWipeNote({ modelId, ratio, reason }) {
  const pct = ratio == null ? '?' : `${Math.round(ratio * 1000) / 10}%`;
  return `KV cache reset: ${shortModel(modelId)} at ${pct} (${reason})`;
}

/**
 * @param {{
 *   getBase?: () => string,
 *   fetchImpl?: typeof fetch,
 *   threshold?: number,
 *   timeoutMs?: number,
 *   nearEmptyRatio?: number,
 *   logger?: { info?: Function, warn?: Function },
 *   onNote?: (note: string) => void,
 * }} [deps]
 */
export function createArenaContextGuard(deps = {}) {
  const getBase = deps.getBase || (() => getLmStudioBase());
  const fetchImpl = deps.fetchImpl || ((...a) => globalThis.fetch(...a));
  const threshold = Number.isFinite(deps.threshold) ? deps.threshold : ARENA_CONTEXT_WIPE_THRESHOLD;
  const timeoutMs = posInt(deps.timeoutMs) || ARENA_CONTEXT_GUARD_TIMEOUT_MS;
  const nearEmptyRatio = Number.isFinite(deps.nearEmptyRatio) ? deps.nearEmptyRatio : ARENA_CONTEXT_NEAR_EMPTY_RATIO;
  const logger = deps.logger || (typeof console !== 'undefined' ? console : {});
  let onNote = typeof deps.onNote === 'function' ? deps.onNote : null;

  const nCtxCache = new Map(); // model → per-slot n_ctx
  const lastFill = new Map(); // model → tokens the slot held after its last answer/wipe
  const inFlight = new Map(); // model → Arena requests streaming right now
  const pending = new Map(); // model → reason a wipe is waiting for in-flight requests to end
  const wiping = new Map(); // model → in-progress wipe promise (dedupe)
  const eraseUnsupported = new Set(); // base|model where erase answered 501

  const warn = (...a) => {
    try { logger.warn?.('[Arena ctx-guard]', ...a); } catch { /* ignore */ }
  };
  const info = (...a) => {
    try { logger.info?.('[Arena ctx-guard]', ...a); } catch { /* ignore */ }
  };

  async function call(url, init) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...(init || {}), signal: ctrl.signal });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      return { ok: !!res.ok, status: Number(res.status) || 0, data };
    } catch (err) {
      return { ok: false, status: 0, data: null, error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err) };
    } finally {
      clearTimeout(t);
    }
  }

  /** @returns {Promise<{ slots: Array|null, status: number }>} */
  async function readSlots(modelId) {
    const r = await call(buildSlotsUrl(getBase(), modelId), { method: 'GET' });
    const slots = r.ok ? parseSlots(r.data) : null;
    if (slots && slots.length) {
      const ctx = slots[0].nCtx;
      if (ctx) nCtxCache.set(modelId, ctx);
    }
    return { slots: slots && slots.length ? slots : null, status: r.status };
  }

  async function nCtxFromModels(modelId) {
    const r = await call(buildModelsUrl(getBase()), { method: 'GET' });
    const n = r.ok ? ctxSizeFromModelsPayload(r.data, modelId) : 0;
    if (n) nCtxCache.set(modelId, n);
    return n;
  }

  async function clearSlot(modelId, slotId) {
    const base = getBase();
    const key = `${guardBaseForModel(base, modelId)}|${modelId}`;
    if (!eraseUnsupported.has(key)) {
      const { url, init } = buildEraseRequest(base, modelId, slotId);
      const r = await call(url, init);
      if (r.ok) return { ok: true, method: 'erase', status: r.status };
      const notSupported = r.status === 501 || r.data?.error?.type === 'not_supported_error';
      if (!notSupported) return { ok: false, method: 'erase', status: r.status, error: r.error || r.data?.error?.message };
      eraseUnsupported.add(key);
    }
    const { url, init } = buildResetRequest(base, modelId, slotId);
    const r = await call(url, init);
    return r.ok
      ? { ok: true, method: 'reset', status: r.status }
      : { ok: false, method: 'reset', status: r.status, error: r.error || r.data?.error?.message };
  }

  function emitNote(note) {
    try { onNote?.(note); } catch { /* ignore */ }
  }

  /**
   * Read the slot(s), decide per slot, clear the ones that need it.
   * @param {string} modelId
   * @param {{ reason: string, extraTokens?: number, snapshot?: Array|null }} o
   */
  async function evaluateAndWipe(modelId, { reason, extraTokens = 0, snapshot = null }) {
    let slots = snapshot;
    let status = 200;
    if (!slots) ({ slots, status } = await readSlots(modelId));
    if (!slots) {
      // 4xx: model not loaded / unknown. Its old KV is gone, so nothing to wipe and nothing to load.
      if (status >= 400 && status < 500) {
        lastFill.delete(modelId);
        pending.delete(modelId);
        return { wiped: false, skipped: 'not-loaded' };
      }
      // /slots unreadable (disabled or timed out): fall back to the last answer's usage.
      const nCtx = nCtxCache.get(modelId) || (await nCtxFromModels(modelId));
      const fill = lastFill.get(modelId);
      if (!nCtx || fill == null) return { wiped: false, skipped: nCtx ? 'unknown-fill' : 'unknown-n_ctx' };
      slots = [{ id: 0, nCtx, fill, processing: false }];
    }
    const results = [];
    let deferred = false;
    for (const s of slots) {
      const d = decideWipe({ fill: s.fill, nCtx: s.nCtx || nCtxCache.get(modelId), extraTokens, threshold, nearEmptyRatio });
      if (!d.wipe) continue;
      // Never cut into a running stream: if our own Arena request for this model is in flight
      // or the server says the slot is busy, wait for the next end/pre-flight.
      if (s.processing || (inFlight.get(modelId) || 0) > 0) {
        deferred = true;
        continue;
      }
      const r = await clearSlot(modelId, s.id);
      const pct = Math.round(d.ratio * 1000) / 10;
      if (r.ok) {
        const note = formatWipeNote({ modelId, ratio: d.ratio, reason });
        info(note, { model: modelId, slot: s.id, percent: pct, tokens: s.fill, n_ctx: s.nCtx, reason, method: r.method });
        emitNote(note);
        results.push({ slot: s.id, ratio: d.ratio, method: r.method });
      } else {
        warn('wipe failed', { model: modelId, slot: s.id, percent: pct, reason, method: r.method, status: r.status, error: r.error });
      }
    }
    if (deferred) pending.set(modelId, reason);
    else pending.delete(modelId);
    if (results.length) lastFill.set(modelId, 1);
    else if (slots.length) lastFill.set(modelId, Math.max(...slots.map((s) => s.fill)));
    return results.length ? { wiped: true, results } : { wiped: false, skipped: deferred ? 'deferred' : 'not-needed' };
  }

  function runWipe(modelId, opts) {
    const existing = wiping.get(modelId);
    if (existing) return existing;
    const p = (async () => {
      try {
        return await evaluateAndWipe(modelId, opts);
      } catch (err) {
        warn('wipe error', modelId, err?.message || err);
        return { wiped: false, skipped: 'error' };
      } finally {
        wiping.delete(modelId);
      }
    })();
    wiping.set(modelId, p);
    return p;
  }

  return {
    threshold,
    setNoteHandler(fn) {
      onNote = typeof fn === 'function' ? fn : null;
    },
    /** Call right before a contestant stream starts. */
    beginRequest(modelId) {
      if (!isGuardableLocalModel(modelId)) return;
      inFlight.set(modelId, (inFlight.get(modelId) || 0) + 1);
    },
    /** Call when that stream ends (any outcome). Runs a deferred wipe once the model is idle. */
    endRequest(modelId) {
      if (!isGuardableLocalModel(modelId)) return;
      const n = Math.max(0, (inFlight.get(modelId) || 0) - 1);
      if (n) inFlight.set(modelId, n);
      else inFlight.delete(modelId);
      if (!n && pending.has(modelId) && !wiping.has(modelId)) {
        void runWipe(modelId, { reason: `deferred: ${pending.get(modelId)}` });
      }
    },
    /**
     * After a contestant answer. Never throws.
     * @param {string} modelId
     * @param {{ usage?: object|null, timings?: object|null }} [o]
     */
    async afterAnswer(modelId, { usage = null, timings = null } = {}) {
      try {
        if (!isGuardableLocalModel(modelId)) return { wiped: false, skipped: 'cloud' };
        const tokens = usageTokens(usage, timings);
        if (tokens) lastFill.set(modelId, tokens.total);
        const cachedCtx = nCtxCache.get(modelId);
        // Cheap path: cached n_ctx and the answer is clearly below the threshold, so skip the network.
        if (cachedCtx && tokens && contextUsageRatio(tokens.prompt, tokens.completion, cachedCtx) < threshold) {
          return { wiped: false, skipped: 'below-threshold' };
        }
        return await runWipe(modelId, { reason: 'after answer' });
      } catch (err) {
        warn('afterAnswer error', modelId, err?.message || err);
        return { wiped: false, skipped: 'error' };
      }
    },
    /**
     * Pre-flight before sending a question: wipe first if cached slot usage + this prompt's
     * estimate + max_tokens would reach the threshold, or a deferred wipe is waiting. Never throws.
     * @param {string} modelId
     * @param {{ messages?: Array, maxTokens?: number }} [o]
     */
    async beforeQuestion(modelId, { messages = [], maxTokens } = {}) {
      try {
        if (!isGuardableLocalModel(modelId)) return { wiped: false, skipped: 'cloud' };
        if ((inFlight.get(modelId) || 0) > 0) return { wiped: false, skipped: 'in-flight' };
        const nCtx = nCtxCache.get(modelId);
        const fill = lastFill.get(modelId);
        const hasPending = pending.has(modelId);
        if (!hasPending && (!nCtx || fill == null)) return { wiped: false, skipped: 'no-history' };
        const extraTokens = estimatePromptTokens(messages) + (posInt(maxTokens) || DEFAULT_MAX_TOKENS);
        if (!hasPending && !decideWipe({ fill, nCtx, extraTokens, threshold, nearEmptyRatio }).wipe) {
          return { wiped: false, skipped: 'below-threshold' };
        }
        return await runWipe(modelId, {
          reason: hasPending ? `deferred: ${pending.get(modelId)}` : 'pre-flight',
          extraTokens: hasPending ? 0 : extraTokens,
        });
      } catch (err) {
        warn('beforeQuestion error', modelId, err?.message || err);
        return { wiped: false, skipped: 'error' };
      }
    },
    /** Test/debug view of internal state. */
    _state: { nCtxCache, lastFill, inFlight, pending, wiping, eraseUnsupported },
  };
}

/** Shared instance for the Arena (one per page, so panels on the same model share in-flight counts). */
export const arenaContextGuard = createArenaContextGuard();
