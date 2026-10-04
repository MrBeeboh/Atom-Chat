/**
 * Qwen3.8-Flash-Next special-casing: the model runs on its own direct llama-server
 * on :8081 (not the :8080 router), with live mmproj caps and a health/stall probe.
 * Extracted from api.js.
 */
import { isQwen38FlashNextSelection } from '$lib/modelIdUtils.js';
import { endpointCapsFromRow } from '$lib/modelCapabilities.js';

/** Direct llama-server for Flash-Next. Do not send this id to the :8080 router. */
export const FLASH_NEXT_CHAT_BASE = 'http://127.0.0.1:8081';
const FLASH_NEXT_START_HINT = 'llama-flash-next restart';

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function firstTokenTimeoutError(model, { multimodal = false, waitMs = 30000 } = {}) {
  const waitLabel = `${Math.round(waitMs / 1000)}s`;
  const err = new Error(
    isQwen38FlashNextSelection(model)
      ? `Qwen3.8-Flash-Next did not emit a token in ${waitLabel}. GPU job is likely stuck — run: ${FLASH_NEXT_START_HINT}`
      : 'No first token from the local server. It may be hung — retry or restart llama-server.',
  );
  err.name = 'FirstTokenTimeout';
  return err;
}

/** Decode counter lives under next_token[] on current llama.cpp slots. */
export function slotDecodedCount(slot) {
  if (!slot || typeof slot !== 'object') return 0;
  const top = Number(slot.n_decoded);
  if (Number.isFinite(top) && top > 0) return top;
  const nt = Array.isArray(slot.next_token) ? slot.next_token[0] : slot.next_token;
  const nested = Number(nt?.n_decoded);
  return Number.isFinite(nested) && nested > 0 ? nested : 0;
}

/**
 * Flash-Next progress probe: prompt eval or decode moving means the GPU is alive
 * even if the browser has not parsed a content delta yet.
 */
export async function flashNextSlotIsAlive() {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/slots`, { signal: ctrl.signal });
      if (!res.ok) return false;
      const rows = await res.json();
      const slot = Array.isArray(rows) ? rows[0] : null;
      if (!slot?.is_processing) return false;
      const processed = Number(slot.n_prompt_tokens_processed) || 0;
      return processed > 0 || slotDecodedCount(slot) > 0;
    } finally {
      clearTimeout(to);
    }
  } catch {
    return false;
  }
}

/**
 * The :8080 proxy row for Flash-Next has no architecture/capabilities.
 * :8081 /props.modalities is the live mmproj flag (vision on/off).
 * @param {{ id: string, caps?: object }[]} items
 */
export async function attachFlashNextLiveCaps(items) {
  if (!Array.isArray(items) || !items.some((m) => isQwen38FlashNextSelection(m?.id))) return items;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/props`, { signal: ctrl.signal });
      if (!res.ok) return items;
      const caps = endpointCapsFromRow(await res.json());
      if (!caps) return items;
      return items.map((m) =>
        isQwen38FlashNextSelection(m?.id) ? { ...m, caps: { ...(m.caps || {}), ...caps } } : m,
      );
    } finally {
      clearTimeout(to);
    }
  } catch {
    return items;
  }
}

/** Live mmproj flag from the Flash-Next server (not the model-id heuristic). */
export async function flashNextHasVision() {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/props`, { signal: ctrl.signal });
      if (!res.ok) return false;
      return endpointCapsFromRow(await res.json())?.vision === true;
    } finally {
      clearTimeout(to);
    }
  } catch {
    return false;
  }
}

/**
 * Flash-Next after an Intel GPU reset still answers /health while the slot
 * sits at 0 tokens processed. Catch that before Arena waits 2 minutes on
 * "Reasoning…".
 */
export async function assertFlashNextCanChat() {
  const healthCtrl = new AbortController();
  const healthTo = setTimeout(() => healthCtrl.abort(), 2500);
  try {
    const health = await fetch(`${FLASH_NEXT_CHAT_BASE}/health`, { signal: healthCtrl.signal });
    if (!health.ok) {
      throw new Error(`Qwen3.8-Flash-Next is not running (health ${health.status}). Start it with: llama-flash-next start`);
    }
  } catch (err) {
    if (err?.message && /Qwen3\.8-Flash-Next is not running/.test(err.message)) throw err;
    return;
  } finally {
    clearTimeout(healthTo);
  }

  let first;
  try {
    const slotsCtrl = new AbortController();
    const slotsTo = setTimeout(() => slotsCtrl.abort(), 2500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/slots`, { signal: slotsCtrl.signal });
      first = res.ok ? await res.json() : null;
    } finally {
      clearTimeout(slotsTo);
    }
  } catch {
    return;
  }
  const slot = Array.isArray(first) ? first[0] : null;
  if (!slot || !slot.is_processing) return;
  const processed = Number(slot.n_prompt_tokens_processed) || 0;
  const decoded = slotDecodedCount(slot);
  if (processed > 0 || decoded > 0) return;
  await sleepMs(4000);
  try {
    const slotsCtrl = new AbortController();
    const slotsTo = setTimeout(() => slotsCtrl.abort(), 2500);
    try {
      const res = await fetch(`${FLASH_NEXT_CHAT_BASE}/slots`, { signal: slotsCtrl.signal });
      const again = res.ok ? await res.json() : null;
      const s2 = Array.isArray(again) ? again[0] : null;
      const processed2 = Number(s2?.n_prompt_tokens_processed) || 0;
      const decoded2 = slotDecodedCount(s2);
      if (s2?.is_processing && processed2 === 0 && decoded2 === 0) {
        throw new Error(
          `Qwen3.8-Flash-Next is stuck (prompt queued, 0 tokens processed). GPU job is dead — run: ${FLASH_NEXT_START_HINT}`,
        );
      }
    } finally {
      clearTimeout(slotsTo);
    }
  } catch (err) {
    if (err?.message && /Qwen3\.8-Flash-Next is stuck/.test(err.message)) throw err;
  }
}
