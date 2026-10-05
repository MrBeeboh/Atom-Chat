/**
 * Arena model picker: one row per model, and no blank type icon.
 * Same id (any case) or the same leaf name from two sources (Nous vs native
 * provider, server alias vs disk path) collapse to the row that has capability
 * data and a known price.
 */
import { isQwen38FlashNextSelection } from '$lib/api.js';
import { isArenaModelEligible } from '$lib/providerFunding.js';
import { getModelCapabilities } from '$lib/modelCapabilities.js';
import { lookupPricing } from '$lib/modelPricing.js';

function leafName(id) {
  const raw = String(id || '').trim();
  const colon = raw.indexOf(':');
  const part = colon > 0 ? raw.slice(colon + 1) : raw;
  const leaf = part.replace(/\\/g, '/').split('/').pop() || part;
  return leaf.trim().toLowerCase().replace(/_/g, '-');
}

/** Strip trailing GGUF quant tags so Q4_K_M / Q8_0 of the same model share one arena slot. */
function stripQuantSuffix(leaf) {
  // After leafName(), underscores are dashes: Q4_K_M -> q4-k-m, Q8_0 -> q8-0, IQ4_NL -> iq4-nl.
  return String(leaf || '').replace(
    /-(?:iq[1-4](?:-[a-z0-9]+)?|q[2-8](?:-[a-z0-9]+)+|q[2-8]|bf16|f16|f32)$/i,
    '',
  );
}

/** Identity that ignores provider prefix and directory. Flash-Next shards share one key. */
export function arenaModelKey(id) {
  if (isQwen38FlashNextSelection(id)) return 'local:qwen3.8-flash-next';
  return stripQuantSuffix(leafName(id));
}

function explicitCaps(row) {
  const caps = row?.caps;
  if (!caps || typeof caps !== 'object') return false;
  return Object.values(caps).some((v) => v === true);
}

function hasCapability(row, catalog) {
  const caps = getModelCapabilities(row.id, catalog, row.caps || null);
  return !!(caps.vision || caps.tools || caps.thinking || caps.json);
}

function rowRank(row, catalog) {
  let rank = 0;
  if (explicitCaps(row)) rank += 8;
  if (hasCapability(row, catalog)) rank += 4;
  const price = lookupPricing(row.id, catalog);
  if (price?.source === 'openrouter' || price?.source === 'deepinfra' || price?.source === 'local') rank += 2;
  if (row?.origin === 'live') rank += 1;
  if (isQwen38FlashNextSelection(row.id) && leafName(row.id) === 'qwen3.8-flash-next') rank += 16;
  return rank;
}

function unionCaps(a, b) {
  if (!a && !b) return undefined;
  const x = a && typeof a === 'object' ? a : {};
  const y = b && typeof b === 'object' ? b : {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of keys) {
    if (typeof x[k] === 'boolean' || typeof y[k] === 'boolean') out[k] = !!(x[k] || y[k]);
    else if (x[k] != null) out[k] = x[k];
    else if (y[k] != null) out[k] = y[k];
  }
  return Object.keys(out).length ? out : undefined;
}

function mergeRows(prev, next, catalog) {
  const base = rowRank(next, catalog) > rowRank(prev, catalog) ? next : prev;
  const other = base === next ? prev : next;
  const caps = unionCaps(base.caps, other.caps);
  const merged = { ...other, ...base, id: base.id };
  if (caps) merged.caps = caps;
  else delete merged.caps;
  return merged;
}

/**
 * @param {{ id: string, caps?: object, origin?: string }[]} models
 * @param {object|null} [catalog] pricing catalog (`{ index }` or the store value)
 */
export function dedupeArenaModels(models, catalog = null) {
  const order = [];
  const byKey = new Map();
  for (const row of models || []) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!id) continue;
    const key = arenaModelKey(id);
    if (!key) continue;
    const next = { ...row, id };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, next);
      order.push(key);
      continue;
    }
    byKey.set(key, mergeRows(prev, next, catalog));
  }
  return order.map((k) => byKey.get(k));
}

/**
 * Dedupe, then drop rows the app cannot type.
 * The live local Qwen3.8-Flash-Next alias (and its GGUF shard, if that is the
 * only row) stays even when the server sent no capability fields.
 * @param {{ id: string, caps?: object, origin?: string }[]} models
 * @param {object|null} [catalog]
 */
export function prepareArenaModelList(models, catalog = null) {
  return dedupeArenaModels(models, catalog).filter((row) => {
    if (!isArenaModelEligible(row.id)) return false;
    if (isQwen38FlashNextSelection(row.id)) return true;
    return hasCapability(row, catalog);
  });
}
