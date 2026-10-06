/**
 * Mutable module-level state shared across the split API modules.
 *
 * These values used to live as top-level `let`s in the single-file api.js. They
 * are cross-cutting: `getLmStudioBase` invalidates them, the backend probes cache
 * into them, and model listing reads them back. Keeping them in one dependency-free
 * module lets every other module read/write them without importing each other
 * (which would otherwise create import cycles).
 */
export const apiState = {
  /** Last resolved LM Studio base URL (cache key for probe invalidation). */
  lastResolvedLmBase: '',
  /** True when GET /api/v1/models succeeds (LM Studio–style management). llama-server returns 404. */
  lmsRestModelsListSupported: null,
  /** True when GET /models (llama.cpp router) succeeds. False = probed and not router. Null = never probed. */
  llamaRouterModelsSupported: null,
  /** Ids from the last successful local model list fetch (used when the server runs a single loaded model). */
  lastLocalModelIds: [],
  /** Cached llama.cpp n_ctx probe result. */
  cachedLocalNCtx: { at: 0, value: 0 },
};
