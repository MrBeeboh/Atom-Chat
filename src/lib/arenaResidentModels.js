/**
 * Arena VRAM planner: keep the largest local models loaded, leave headroom
 * to swap smaller ones, and never spend VRAM on cloud models.
 *
 * llama.cpp router (`--models-max N`) is the fast path: once a model is loaded
 * it stays until we unload it or the slot cap evicts it. Arena previously
 * forced `--models-max 1` and ejected after every slot, which is why mixed
 * local/cloud runs timed out and scored zeros.
 */
import { isCloudModel } from './arenaLogic.js';
import { parseSizeFromName } from './utils/modelSelection.js';
import { isQwen38FlashNextSelection } from './modelIdUtils.js';

/** Fraction of reported VRAM left free for KV cache, activations, and a swap. */
export const DEFAULT_HEADROOM = 0.2;

/** Fallback when hardware metrics are missing (one Arc Pro B70-class card ≈ 32 GB). */
export const DEFAULT_VRAM_GB = 32;

/** Flash-Next runs in its own Docker server on :8081 and takes both cards plus host RAM. */
const FLASH_NEXT_GB = 85;

/**
 * Router aliases from models-preset.ini often drop the parameter count.
 * Qwen3-Next / Qwen3-Coder-Next are 80B-A3B MoE (~45-48 GB at Q4).
 */
const KNOWN_FAMILY_PARAMS_B = [
  { test: /coder-next|qwen3-next|qwen3\.\d+-next/i, paramsB: 80 },
];

const QUANT_BYTES_PER_PARAM = [
  { test: /f32|fp32/i, bytes: 4.0 },
  { test: /f16|fp16|bf16/i, bytes: 2.0 },
  { test: /q8_0|q8/i, bytes: 1.05 },
  { test: /q6_k|q6/i, bytes: 0.8 },
  { test: /q5_k|q5/i, bytes: 0.7 },
  { test: /q3_k|q3|iq3/i, bytes: 0.45 },
  { test: /q2_k|q2|iq2/i, bytes: 0.35 },
  { test: /q4_k|q4|iq4|imatrix|i-?matrix/i, bytes: 0.6 },
];

/** Runtime overhead on top of weights (compute graph, default context). */
const RUNTIME_OVERHEAD_GB = 0.9;

/**
 * Lowercase GGUF basename for matching disk paths vs server ids.
 * @param {string} id
 * @returns {string}
 */
export function localModelKey(id) {
  if (!id || typeof id !== 'string') return '';
  const s = id.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return (i === -1 ? s : s.slice(i + 1)).toLowerCase();
}

export function sameLocalModel(a, b) {
  const ka = localModelKey(a);
  const kb = localModelKey(b);
  return Boolean(ka && kb && ka === kb);
}

function bytesPerParam(modelId) {
  const id = String(modelId || '');
  for (const { test, bytes } of QUANT_BYTES_PER_PARAM) {
    if (test.test(id)) return bytes;
  }
  return 0.6;
}

/**
 * Rough VRAM footprint in GB from the model id (param count × quant).
 * Returns null when the id carries no size, so callers never pin a guess.
 * @param {string} modelId
 * @returns {number | null}
 */
export function estimateVramGb(modelId) {
  if (!modelId || isCloudModel(modelId)) return 0;
  if (isQwen38FlashNextSelection(modelId)) return FLASH_NEXT_GB;
  let paramsB = parseSizeFromName(modelId);
  if (!Number.isFinite(paramsB)) {
    paramsB = KNOWN_FAMILY_PARAMS_B.find(({ test }) => test.test(String(modelId)))?.paramsB ?? NaN;
  }
  if (!Number.isFinite(paramsB)) return null;
  const gb = paramsB * bytesPerParam(modelId) + RUNTIME_OVERHEAD_GB;
  return Math.max(1.5, Math.round(gb * 10) / 10);
}

/**
 * Models that need the whole box: Flash-Next (both cards on :8081), anything
 * larger than one card (layer-split across both), and ids with no known size.
 * Nothing else can stay loaded beside them.
 * @param {string} modelId
 * @param {number} perCardBudgetGb
 */
export function needsExclusiveVram(modelId, perCardBudgetGb) {
  if (!modelId || isCloudModel(modelId)) return false;
  if (isQwen38FlashNextSelection(modelId)) return true;
  const gb = estimateVramGb(modelId);
  return gb == null || gb > perCardBudgetGb;
}

/**
 * @param {string[]} loadedIds
 * @param {string[]} keepIds
 * @returns {string[]} loaded ids that are not in the keep set
 */
export function modelsToUnload(loadedIds, keepIds) {
  const keep = new Set((keepIds || []).map(localModelKey).filter(Boolean));
  return (loadedIds || []).filter((id) => {
    if (!id || isCloudModel(id)) return false;
    const key = localModelKey(id);
    if (!key) return false;
    return !keep.has(key);
  });
}

function uniqueLocalIds(modelIds) {
  const out = [];
  const seen = new Set();
  for (const id of modelIds || []) {
    if (!id || typeof id !== 'string' || isCloudModel(id)) continue;
    const key = localModelKey(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/**
 * Pin the largest local models that fit in VRAM with headroom; the rest swap.
 *
 * @param {object} opts
 * @param {string[]} opts.modelIds - Contestants + judge
 * @param {number} [opts.vramTotalGb]
 * @param {number} [opts.gpuCount]
 * @param {number} [opts.headroomFraction]
 * @returns {{
 *   residents: string[],
 *   swap: string[],
 *   cloud: string[],
 *   exclusive: string[],
 *   budgetGb: number,
 *   usedGb: number,
 *   vramTotalGb: number,
 *   gpuCount: number,
 *   parallelLocals: boolean,
 *   summary: string,
 * }}
 */
export function planArenaResidents({
  modelIds = [],
  vramTotalGb,
  gpuCount = 1,
  headroomFraction = DEFAULT_HEADROOM,
} = {}) {
  const gpus = Math.max(1, Number(gpuCount) || 1);
  let vram = Number(vramTotalGb);
  if (!Number.isFinite(vram) || vram <= 0) {
    vram = DEFAULT_VRAM_GB * (gpus > 1 ? gpus : 1);
  }
  const headroom = Math.min(0.45, Math.max(0.1, Number(headroomFraction) || DEFAULT_HEADROOM));
  // Router preset pins single-card models to one GPU, so co-residents share one card.
  const budgetGb = Math.round((vram / gpus) * (1 - headroom) * 10) / 10;

  const cloud = [...new Set((modelIds || []).filter((id) => id && isCloudModel(id)))];
  const local = uniqueLocalIds(modelIds);
  const exclusive = local.filter((id) => needsExclusiveVram(id, budgetGb));
  const sized = local.map((id) => ({ id, gb: estimateVramGb(id) ?? Infinity }));
  sized.sort((a, b) => b.gb - a.gb || a.id.localeCompare(b.id));

  const totalLocal = sized.reduce((s, m) => s + m.gb, 0);
  if (sized.length === 0) {
    return {
      residents: [],
      swap: [],
      cloud,
      exclusive,
      budgetGb,
      usedGb: 0,
      vramTotalGb: vram,
      gpuCount: gpus,
      parallelLocals: false,
      summary: cloud.length
        ? `Cloud-only Arena (${cloud.length} API model${cloud.length === 1 ? '' : 's'}).`
        : 'No local models to pin.',
    };
  }

  if (exclusive.length > 0) {
    const names = exclusive.map((id) => localModelKey(id) || id).join(', ');
    return {
      residents: [],
      swap: sized.map((m) => m.id),
      cloud,
      exclusive,
      budgetGb,
      usedGb: 0,
      vramTotalGb: vram,
      gpuCount: gpus,
      parallelLocals: false,
      summary: `${names} need${exclusive.length === 1 ? 's' : ''} the whole GPU box. Running local models one at a time.`,
    };
  }

  if (totalLocal <= budgetGb) {
    const usedGb = Math.round(totalLocal * 10) / 10;
    return {
      residents: sized.map((m) => m.id),
      swap: [],
      cloud,
      exclusive,
      budgetGb,
      usedGb,
      vramTotalGb: vram,
      gpuCount: gpus,
      parallelLocals: gpus >= 2 && sized.length >= 2,
      summary: `Keeping ${sized.length} local model${sized.length === 1 ? '' : 's'} loaded (~${usedGb} GB of ${budgetGb} GB budget${gpus > 1 ? `, ${gpus} GPUs` : ''}).`,
    };
  }

  const residents = [];
  let used = 0;
  for (const m of sized) {
    const leftover = sized.filter((x) => x.id !== m.id && !residents.some((r) => sameLocalModel(r, x.id)));
    const swapNeed = leftover.length ? Math.max(...leftover.map((x) => x.gb)) : 0;
    if (used + m.gb + swapNeed <= budgetGb) {
      residents.push(m.id);
      used += m.gb;
    }
  }

  const swap = sized.map((m) => m.id).filter((id) => !residents.some((r) => sameLocalModel(r, id)));
  const usedGb = Math.round(used * 10) / 10;
  const largestNames = residents.map((id) => localModelKey(id) || id);
  return {
    residents,
    swap,
    cloud,
    exclusive,
    budgetGb,
    usedGb,
    vramTotalGb: vram,
    gpuCount: gpus,
    parallelLocals: gpus >= 2 && residents.length >= 2,
    summary:
      residents.length === 0
        ? `No local model fits in ${budgetGb} GB. Loading one at a time.`
        : `Keeping ${residents.length} loaded (${largestNames.join(', ')}; ~${usedGb} GB). Swapping ${swap.length} smaller model${swap.length === 1 ? '' : 's'} into leftover VRAM.`,
  };
}

/**
 * Run whichever swap model is already in VRAM first, so a lineup of two big
 * models costs one swap per round instead of two.
 * @template {{ modelId: string }} T
 * @param {T[]} rows
 * @param {string[]} loadedIds
 * @returns {T[]}
 */
export function orderSwapRows(rows, loadedIds) {
  const isLoaded = (id) => (loadedIds || []).some((l) => sameLocalModel(l, id));
  const loaded = (rows || []).filter((r) => isLoaded(r.modelId));
  const rest = (rows || []).filter((r) => !isLoaded(r.modelId));
  return [...loaded, ...rest];
}

export function isResidentModel(plan, modelId) {
  if (!plan || !modelId || isCloudModel(modelId)) return false;
  return (plan.residents || []).some((id) => sameLocalModel(id, modelId));
}
