/**
 * Pure model-id helpers: classification, normalization, display formatting, and
 * model-list merging. No fetch, no shared state — extracted from api.js so they
 * can be unit-tested in isolation.
 */
import { CLOUD_PROVIDERS } from '$lib/cloudCatalog.js';
import { endpointCapsFromRow } from '$lib/modelCapabilities.js';

/** Model id the already-loaded Flash-Next server advertises. */
export const QWEN38_FLASH_NEXT_MODEL_ID = 'Qwen3.8-Flash-Next';

/**
 * True for the proxy alias or a local-disk shard whose filename is the Flash-Next GGUF.
 * Cloud ids (provider:model) are never this.
 * @param {string} modelId
 */
export function isQwen38FlashNextSelection(modelId) {
  if (!modelId || typeof modelId !== 'string' || modelId.includes(':')) return false;
  const leaf = modelId.replace(/\\/g, '/').split('/').pop() || '';
  const name = leaf.trim().toLowerCase();
  if (name === 'qwen3.8-flash-next') return true;
  return name.startsWith('qwen3.8-flash-next') && name.endsWith('.gguf');
}

/**
 * Request-body model field. Disk picks use the GGUF filename; the proxy only
 * forwards the alias and would otherwise ask the router to load the shard.
 * @param {string} selectedId
 * @param {string} resolvedId
 */
export function localChatModelIdForRequest(selectedId, resolvedId) {
  if (isQwen38FlashNextSelection(selectedId) || isQwen38FlashNextSelection(resolvedId)) {
    return QWEN38_FLASH_NEXT_MODEL_ID;
  }
  return resolvedId;
}

/** 0 / NaN / -1 must not become unlimited n_predict on llama.cpp. */
export function clampChatMaxTokens(raw, { cloud = false } = {}) {
  const n = Number(raw);
  const fallback = 4096;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const cap = cloud ? 8192 : 100000;
  return Math.min(cap, Math.floor(n));
}

/** Human-readable label for the model dropdown. "deepseek:deepseek-chat" → "DeepSeek: deepseek-chat". */
export function modelDisplayName(id) {
  if (!id || typeof id !== 'string') return id;
  const i = id.indexOf(':');
  if (i === -1) {
    if (id.endsWith('.gguf') && (id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id))) {
      const base = id.replace(/\\/g, '/').split('/').pop();
      return base ? `${base}  —  ${id}` : id;
    }
    return id;
  }
  const provider = id.slice(0, i);
  const label = CLOUD_PROVIDERS[provider]?.name ?? provider;
  return `${label}: ${id.slice(i + 1)}`;
}

/** Compact primary line in grouped model lists (provider shown in section header). */
export function modelSelectorPrimaryLine(id) {
  if (!id || typeof id !== 'string') return '';
  const i = id.indexOf(':');
  if (i > 0) {
    const rest = id.slice(i + 1).trim();
    return rest || id;
  }
  if (id.endsWith('.gguf') && (id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id))) {
    return id.replace(/\\/g, '/').split('/').pop() || id;
  }
  return id;
}

/** Optional subtitle (folder path for disk models). */
export function modelSelectorSecondaryLine(id) {
  if (!id || typeof id !== 'string') return null;
  if (id.indexOf(':') > 0) return null;
  if (!(id.endsWith('.gguf') && (id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id)))) return null;
  const norm = id.replace(/\\/g, '/');
  const base = norm.split('/').pop();
  if (!base || norm.length <= base.length) return null;
  return norm.slice(0, norm.length - base.length - 1) || null;
}

/** Resolve model id for the API request (cloud: use part after colon; local: use as-is). */
export function resolveModelId(modelId) {
  if (!modelId || typeof modelId !== 'string') return modelId;
  const colon = modelId.indexOf(':');
  return colon === -1 ? modelId : modelId.slice(colon + 1);
}

/** Lowercase filename for deduping disk paths vs server-reported model names. */
export function ggufBasenameLower(id) {
  if (!id || typeof id !== 'string') return '';
  const s = id.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return (i === -1 ? s : s.slice(i + 1)).toLowerCase();
}

/**
 * llama-server /v1/chat/completions expects the loaded model id (usually the .gguf basename).
 * Disk inventory uses absolute paths under ~/.lmstudio/models.
 */
export function localModelIdForOpenAIRequest(id) {
  if (!id || typeof id !== 'string') return id;
  if (id.startsWith('/')) {
    const base = id.replace(/\\/g, '/').split('/').pop();
    return base && base.endsWith('.gguf') ? base : id;
  }
  if (/^[A-Za-z]:[\\/]/.test(id)) {
    const base = id.replace(/\\/g, '/').split('/').pop();
    return base && base.endsWith('.gguf') ? base : id;
  }
  return id;
}

/** True when model id is Grok (grok:grok-4, etc.). Used to route to Responses API with tools for real-time search. */
export function isGrokModel(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('grok:');
}

/** True when model id is DeepSeek (deepseek:deepseek-chat, etc.). Used to route image generation. */
export function isDeepSeekModel(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('deepseek:');
}

/** True when model id is DeepInfra. Used to route to DeepInfra's OpenAI-compatible endpoint. */
export function isDeepinfraModel(modelId) {
  return typeof modelId === 'string' && modelId.startsWith('deepinfra:');
}

/**
 * Merge server model list with disk scan: server order first.
 * Disk rows whose basename already appears on the server are skipped.
 * Two disk copies with the same filename in different folders both stay visible.
 * @param {{ id: string }[]} fromServer
 * @param {{ id: string }[]} fromDisk
 */
export function mergeServerAndDiskModels(fromServer, fromDisk) {
  const seenFull = new Set();
  const serverBases = new Set();
  const out = [];
  for (const m of fromServer || []) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    const fullKey = id.toLowerCase();
    if (seenFull.has(fullKey)) continue;
    seenFull.add(fullKey);
    const baseKey = ggufBasenameLower(id);
    if (baseKey.endsWith('.gguf')) serverBases.add(baseKey);
    out.push(m.caps && typeof m.caps === 'object' ? { id, caps: m.caps } : { id });
  }
  for (const m of fromDisk || []) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!id) continue;
    const fullKey = id.toLowerCase();
    if (seenFull.has(fullKey)) continue;
    const baseKey = ggufBasenameLower(id);
    if (baseKey.endsWith('.gguf') && serverBases.has(baseKey)) continue;
    seenFull.add(fullKey);
    out.push(m.caps && typeof m.caps === 'object' ? { id, caps: m.caps } : { id });
  }
  return out;
}

/**
 * Normalize a single model entry from LM Studio REST or OpenAI-compat response to { id }.
 * REST: { type, key, id?, display_name? }. OpenAI: { id }.
 */
export function toModelItem(m) {
  if (!m || typeof m !== 'object') return null;
  const id = m.key ?? m.id ?? m.model ?? m.name ?? m.display_name;
  if (typeof id !== 'string' || !id.trim()) return null;
  const caps = endpointCapsFromRow(m) || (m.caps && typeof m.caps === 'object' ? m.caps : null);
  return caps ? { id: id.trim(), caps } : { id: id.trim() };
}

/** Dedupe by lowercase id (llama-server may list the same model under `models` and `data`). */
export function mergeUniqueModelItems(entries) {
  const seen = new Set();
  const out = [];
  for (const m of entries) {
    const item = toModelItem(m);
    if (!item) continue;
    const k = item.id.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
