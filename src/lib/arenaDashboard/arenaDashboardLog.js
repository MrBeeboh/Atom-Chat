/**
 * Log a warning to console
 * @param {string} context
 * @param {Error} err
 * @param {Record<string, any>} extra
 */
export function arenaWarn(context, err, extra = {}) {
  console.warn(`[Arena ${context}]`, err?.message || err, extra);
}