/**
 * Anonymous arena lineup. Classes come only from capability flags already
 * computed (reasoner = thinking, tools, vision). Size comes only from a
 * catalog field that already exists: OpenRouter context_length, grouped
 * into a few ranges, or one parameter-size control when that field is
 * present and context length is not. No guessed model classes.
 */
import { getModelCapabilities } from '$lib/modelCapabilities.js';
import { formatContextTokens, matchOpenRouterModel } from '$lib/modelPricing.js';

export const ARENA_PICK_CLASSES = [
  { id: 'reasoner', label: 'Reasoner', flag: 'thinking' },
  { id: 'tools', label: 'Tools', flag: 'tools' },
  { id: 'vision', label: 'Vision', flag: 'vision' },
];

/** Keys already used by some catalogs. A missing key is not a size. */
const PARAMETER_FIELDS = ['parameter_size', 'parameter_count', 'num_parameters'];

export function arenaClassIds(modelId, catalog, endpointCaps) {
  const caps = getModelCapabilities(modelId, catalog, endpointCaps);
  return ARENA_PICK_CLASSES.filter((c) => caps[c.flag] === true).map((c) => c.id);
}

/**
 * @param {string} modelId
 * @param {object|null} catalog
 * @returns {{ context: number|null, parameters: number|null }}
 */
export function arenaCatalogSize(modelId, catalog) {
  const hit = matchOpenRouterModel(modelId, catalog?.index);
  if (!hit || typeof hit !== 'object') return { context: null, parameters: null };
  const contextRaw = Number(hit.context_length);
  const context = Number.isFinite(contextRaw) && contextRaw > 0 ? contextRaw : null;
  let parameters = null;
  for (const key of PARAMETER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(hit, key)) continue;
    const n = Number(hit[key]);
    if (Number.isFinite(n) && n > 0) {
      parameters = n;
      break;
    }
  }
  return { context, parameters };
}

export function arenaContextLabel(tokens) {
  return formatContextTokens(tokens);
}

/** Ranges over real context_length values. Empty ranges are not offered. */
export const ARENA_CONTEXT_BUCKETS = [
  { id: 'ctx:under-32k', label: 'Under 32K', phrase: 'context under 32K', min: 1, max: 32767 },
  { id: 'ctx:32k-128k', label: '32K to 128K', phrase: 'context from 32K to 128K', min: 32768, max: 131072 },
  { id: 'ctx:over-128k', label: 'Over 128K', phrase: 'context over 128K', min: 131073, max: Infinity },
];

export function arenaContextBucketId(tokens) {
  const n = Number(tokens);
  const hit = ARENA_CONTEXT_BUCKETS.find((b) => Number.isFinite(n) && n >= b.min && n <= b.max);
  return hit ? hit.id : '';
}

/** Old exact ctx:8192 picks become the bucket that contains that length. */
export function normalizeArenaSizeId(sizeId) {
  const id = String(sizeId || '');
  if (!id) return '';
  if (ARENA_CONTEXT_BUCKETS.some((b) => b.id === id) || id === 'params:any') return id;
  if (id.startsWith('ctx:')) {
    const n = Number(id.slice(4));
    return arenaContextBucketId(n);
  }
  if (id.startsWith('params:')) return 'params:any';
  return '';
}

/**
 * @param {{ id: string, caps?: object }[]} models
 * @param {object|null} catalog
 * @param {string} [classId]
 */
export function arenaPickOptions(models, catalog, classId = '') {
  const rows = Array.isArray(models) ? models.filter((m) => m && m.id) : [];
  const classHits = new Set();
  /** @type {Map<number, number>} */
  const contexts = new Map();
  /** @type {Map<number, number>} */
  const parameters = new Map();
  for (const row of rows) {
    const classes = arenaClassIds(row.id, catalog, row.caps || null);
    for (const id of classes) classHits.add(id);
    if (classId && !classes.includes(classId)) continue;
    const size = arenaCatalogSize(row.id, catalog);
    if (size.context != null) contexts.set(size.context, (contexts.get(size.context) || 0) + 1);
    if (size.parameters != null) parameters.set(size.parameters, (parameters.get(size.parameters) || 0) + 1);
  }
  const bucketIds = new Set();
  for (const n of contexts.keys()) {
    const id = arenaContextBucketId(n);
    if (id) bucketIds.add(id);
  }
  const sizes = ARENA_CONTEXT_BUCKETS.filter((b) => bucketIds.has(b.id)).map((b) => ({ id: b.id, label: b.label }));
  return {
    classes: ARENA_PICK_CLASSES.filter((c) => classHits.has(c.id)),
    sizes,
    contextNote: sizes.length ? sizes.map((b) => b.label).join(', ') : 'not listed',
  };
}

/**
 * @param {{ models: { id: string, caps?: object }[], catalog: object|null, classId: string, sizeId?: string, quantity: number }} opts
 */
export const ARENA_BATTLES = [
  { id: 'text', label: 'Text' },
  { id: 'vision', label: 'Vision' },
  { id: 'code', label: 'Code' },
];

/** Text and code take any selectable chat model. Vision requires the existing vision flag. */
export function modelSitsInArena(modelId, arena, catalog, endpointCaps) {
  const kind = arena === 'vision' || arena === 'code' ? arena : 'text';
  if (kind !== 'vision') return true;
  return getModelCapabilities(modelId, catalog, endpointCaps).vision === true;
}

function sampleModels(rows, quantity, random) {
  const arr = [...rows];
  const rnd = typeof random === 'function' ? random : Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const swap = arr[i];
    arr[i] = arr[j];
    arr[j] = swap;
  }
  return arr.slice(0, quantity);
}

export function pickArenaLineup({ models, catalog, arena = 'text', quantity, random } = {}) {
  const q = Math.min(4, Math.max(1, Math.floor(Number(quantity)) || 2));
  const kind = arena === 'vision' || arena === 'code' ? arena : 'text';
  const battle = ARENA_BATTLES.find((b) => b.id === kind);
  const pool = [];
  const seen = new Set();
  for (const row of models || []) {
    if (!row?.id || seen.has(row.id)) continue;
    if (!modelSitsInArena(row.id, kind, catalog, row.caps || null)) continue;
    seen.add(row.id);
    pool.push(row);
  }
  const chosen = sampleModels(pool, q, random);
  return {
    ids: chosen.map((m) => m.id),
    available: pool.length,
    quantity: q,
    arena: kind,
    arenaLabel: battle.label,
  };
}

export function arenaShortfallStatus({ arenaLabel = '', available = 0, quantity = 2 }) {
  const name = arenaLabel || 'Text';
  if (available <= 0) return `No models for the ${name} arena.`;
  if (available < quantity) {
    const noun = available === 1 ? 'model' : 'models';
    return `Only ${available} ${noun} can sit in the ${name} arena. Running ${available}.`;
  }
  return '';
}

export function arenaRunPlan({ mode = 'anonymous', arena = 'text', quantity = 2, available = null }) {
  // Named mode: columns already show the pickers — no instructional banner.
  if (mode === 'named') return '';
  const kind = arena === 'vision' || arena === 'code' ? arena : 'text';
  const q = Math.min(4, Math.max(1, Math.floor(Number(quantity)) || 2));
  // Only speak when the pool is short; avoid always-on “N models…” chrome.
  if (available === 0) return `No models for the ${kind} arena.`;
  if (available != null && available < q) {
    const noun = available === 1 ? 'model' : 'models';
    return `Only ${available} ${noun} in the ${kind} arena. Running ${available}.`;
  }
  return '';
}

/** Tags written after a judged round. Not used to choose contestants. */
export function postHocScoreTags(modelId, catalog, endpointCaps) {
  if (!modelId) return { tag_thinking: null, tag_tools: null, tag_vision: null, context_bucket: null };
  const caps = getModelCapabilities(modelId, catalog, endpointCaps);
  const size = arenaCatalogSize(modelId, catalog);
  const bucket = size.context != null ? arenaContextBucketId(size.context) : '';
  return {
    tag_thinking: caps.thinking ? 1 : 0,
    tag_tools: caps.tools ? 1 : 0,
    tag_vision: caps.vision ? 1 : 0,
    context_bucket: bucket || null,
  };
}
