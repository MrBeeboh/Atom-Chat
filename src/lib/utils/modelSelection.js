/**
 * @file modelSelection.js
 * @description Model selection helpers by size: parseSizeFromName(), findSmallestModel(), findLargestModel().
 * Used for smart defaults (e.g. pick smallest model) and for Optimize fallback (pick largest as advisor).
 */

/** Matches e.g. 8b, 21B, 6.9B, 8.2B, 21b-a3b (first number in billions). */
const SIZE_REGEX = /\d+(?:\.\d+)?[bB]/i;

/**
 * Parse size from model name (e.g. "ernie-4.5-21b-a3b" -> 21, "llama-3.1-8b" -> 8, "minicpm-6.9b" -> 6.9).
 * Uses parameter count in billions from the model id; correlates with size on disk.
 * @param {string} name - Model id/name
 * @returns {number} Size in billions, or Infinity if no match (treated as "large")
 */
export function parseSizeFromName(name) {
  if (typeof name !== 'string') return Infinity;
  const m = name.match(SIZE_REGEX);
  if (!m) return Infinity;
  const num = parseFloat(m[0].replace(/[bB]$/i, ''), 10);
  return Number.isFinite(num) && num > 0 ? num : Infinity;
}

/**
 * Pick the smallest model from a list of model ids (by parsed size, then alphabetically).
 * @param {string[]} ids - Array of model id strings
 * @returns {string|null} Smallest model id, or null if list is empty
 */
export function findSmallestModel(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const sorted = [...ids].sort((a, b) => {
    const sizeA = parseSizeFromName(a);
    const sizeB = parseSizeFromName(b);
    if (sizeA !== sizeB) return sizeA - sizeB;
    return (a || '').localeCompare(b || '');
  });
  return sorted[0];
}

/**
 * Pick the largest (smartest) model from a list for advisory tasks.
 * @param {string[]} ids - Array of model id strings
 * @returns {string|null} Largest model id, or null if list is empty
 */
export function findLargestModel(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const sorted = [...ids].sort((a, b) => {
    const sizeA = parseSizeFromName(a);
    const sizeB = parseSizeFromName(b);
    if (sizeA !== sizeB) return sizeB - sizeA; // descending
    return (a || '').localeCompare(b || '');
  });
  return sorted[0];
}
