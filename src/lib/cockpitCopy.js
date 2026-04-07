/**
 * Status copy for Cockpit: one clear label per state (no rotation).
 */

// LM Studio connection (header)
export const COCKPIT_LM_CHECKING = 'Checking…';
export const COCKPIT_LM_CONNECTED = 'Connected';
export const COCKPIT_LM_UNREACHABLE = 'Disconnected';
export const COCKPIT_CLOUD_APIS_AVAILABLE = 'Cloud only';

// Model dropdown
export const COCKPIT_LOADING_MODELS = 'Loading models…';

// Chat input (sending / search)
export const COCKPIT_SENDING = 'Sending…';
export const COCKPIT_SEARCHING = 'Searching…';

/** For backward compatibility: return string or first element of array. */
export function pickWitty(x) {
  if (typeof x === 'string') return x;
  if (Array.isArray(x) && x.length) return x[0];
  return '';
}
