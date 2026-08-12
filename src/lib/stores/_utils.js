/** @param {string} key @param {boolean} fallback */
export function readBool(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  if (v == null) return fallback;
  return v === '1' || v === 'true';
}

/** @param {string} key @param {number} fallback */
export function readNum(key, fallback) {
  if (typeof localStorage === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
