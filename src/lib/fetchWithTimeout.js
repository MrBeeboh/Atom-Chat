/**
 * `fetch` with an absolute timeout.
 *
 * Replaces the `new AbortController()` + `setTimeout(() => ctrl.abort(), ms)` +
 * `clearTimeout` boilerplate that was copy-pasted across the API client. A
 * caller-supplied `opts.signal` still aborts the request; the timeout is cleared
 * as soon as the response headers arrive, so body streaming is not clipped.
 *
 * @param {string} url
 * @param {RequestInit} [opts]
 * @param {number} ms - timeout in milliseconds
 * @returns {Promise<Response>}
 */
export function fetchWithTimeout(url, opts = {}, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => {
    clearTimeout(to);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  });
}
