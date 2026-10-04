/**
 * Pure Arena view helpers extracted from DashboardArena so they can be unit-tested
 * and reused outside the component.
 */

/** Convert a byte array (e.g. report PDF bytes) to a base64 string. */
export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Latest assistant tok/s for a slot, formatted to one decimal. Prefers the
 * server-reported `tok_per_sec` and falls back to tokens / elapsed seconds.
 * @param {Array<{ role: string, stats?: object }>} msgs
 * @returns {string | null}
 */
export function lastTps(msgs) {
  const last = [...(msgs || [])].reverse().find((m) => m.role === 'assistant' && m.stats);
  if (!last?.stats) return null;
  const fromServer = Number(last.stats.tok_per_sec);
  if (Number.isFinite(fromServer) && fromServer > 0) return fromServer.toFixed(1);
  const { completion_tokens, elapsed_ms } = last.stats;
  if (!(elapsed_ms > 0) || !(completion_tokens > 0)) return null;
  return (completion_tokens / (elapsed_ms / 1000)).toFixed(1);
}
