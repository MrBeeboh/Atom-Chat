/**
 * Permanent local-context policy: each model uses its own trained max.
 *
 * llama.cpp `--ctx-size 0` reads n_ctx_train from the GGUF. ATOM must not
 * substitute a 32 768 family/README cap, and must not inflate every model
 * to 256k to fill VRAM.
 *
 * Slider ceiling is only so 128k/256k models can be displayed or lowered.
 */

/** Old ATOM family/README cap. Never re-apply this as a default. */
export const LEGACY_CONTEXT_CAP = 32768;

/** Slider / load-API ceiling. Not a request — models keep their own n_ctx_train. */
export const LOCAL_CONTEXT_UI_MAX = 262144;

/** Max tokens the UI will let you set for one local completion. */
export const LOCAL_MAX_TOKENS_UI_MAX = 131072;

/** llama.cpp `--ctx-size 0` = GGUF training context (the model's max). */
export const LOCAL_LLAMA_CTX_SIZE = 0;

/** Stale values ATOM used to write into settings (not necessarily the model's max). */
const STALE_ATOM_CONTEXT_DEFAULTS = new Set([4096, 8192, 16384, LEGACY_CONTEXT_CAP]);

/**
 * Pick the context to request.
 * Prefer the model's trained max when known. Otherwise keep a real user value,
 * or 0 meaning “native / do not cap”.
 * @param {unknown} value
 * @param {unknown} [modelMax] GGUF n_ctx_train / HF max_position_embeddings
 * @returns {number}
 */
export function resolveLocalContextLength(value, modelMax) {
  const known = Number(modelMax);
  if (Number.isFinite(known) && known > 0) return Math.floor(known);

  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return LOCAL_LLAMA_CTX_SIZE;
  if (STALE_ATOM_CONTEXT_DEFAULTS.has(n)) return LOCAL_LLAMA_CTX_SIZE;
  return Math.min(LOCAL_CONTEXT_UI_MAX, Math.floor(n));
}

/**
 * True when a stored context_length is ATOM's old cap, not a model max we should keep.
 * @param {unknown} value
 */
export function isStaleAtomContextCap(value) {
  const n = Number(value);
  return Number.isFinite(n) && STALE_ATOM_CONTEXT_DEFAULTS.has(n);
}

/**
 * Generation cap for one reply.
 * @param {unknown} value
 * @returns {number}
 */
export function resolveLocalMaxTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 4096;
  return Math.min(LOCAL_MAX_TOKENS_UI_MAX, Math.max(64, Math.floor(n)));
}

/**
 * Drop stale 32k (and smaller) ATOM caps from a saved settings object so the
 * backend falls through to the model's native max.
 * @template {Record<string, unknown>} T
 * @param {T} obj
 * @returns {T}
 */
export function migrateLocalContextSettings(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!Object.prototype.hasOwnProperty.call(obj, 'context_length')) return obj;
  if (!isStaleAtomContextCap(obj.context_length)) return obj;
  const next = { ...obj };
  delete next.context_length;
  return next;
}
