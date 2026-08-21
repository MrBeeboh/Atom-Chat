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

/** Fraction of reported VRAM left free for KV cache, activations, and a swap. */
export const DEFAULT_HEADROOM = 0.2;

/** Fallback when hardware metrics are missing (one mid-range GPU). */
export const DEFAULT_VRAM_GB = 16;

/** Unknown-size GGUF: treat as a medium 8B-class Q4 so we still pin something. */
const UNKNOWN_MODEL_GB = 6.5;

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
 * @param {string} modelId
 * @returns {number}
 */
export function estimateVramGb(modelId) {
  if (!modelId || isCloudModel(modelId)) return 0;
  const paramsB = parseSizeFromName(modelId);
  if (!Number.isFinite(paramsB) || paramsB === Infinity) return UNKNOWN_MODEL_GB;
  const gb = paramsB * bytesPerParam(modelId) + RUNTIME_OVERHEAD_GB;
  return Math.max(1.5, Math.round(gb * 10) / 10);
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
  const budgetGb = Math.round(vram * (1 - headroom) * 10) / 10;

  const cloud = [...new Set((modelIds || []).filter((id) => id && isCloudModel(id)))];
  const local = uniqueLocalIds(modelIds);
  const sized = local.map((id) => ({ id, gb: estimateVramGb(id) }));
  sized.sort((a, b) => b.gb - a.gb || a.id.localeCompare(b.id));

  const totalLocal = sized.reduce((s, m) => s + m.gb, 0);
  if (sized.length === 0) {
    return {
      residents: [],
      swap: [],
      cloud,
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

  if (totalLocal <= budgetGb) {
    const usedGb = Math.round(totalLocal * 10) / 10;
    return {
      residents: sized.map((m) => m.id),
      swap: [],
      cloud,
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

  if (residents.length === 0) {
    const firstFit = sized.find((m) => m.gb <= budgetGb);
    if (firstFit) {
      residents.push(firstFit.id);
      used = firstFit.gb;
    }
  }

  const swap = sized.map((m) => m.id).filter((id) => !residents.some((r) => sameLocalModel(r, id)));
  const usedGb = Math.round(used * 10) / 10;
  const largestNames = residents.map((id) => localModelKey(id) || id);
  return {
    residents,
    swap,
    cloud,
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

export function isResidentModel(plan, modelId) {
  if (!plan || !modelId || isCloudModel(modelId)) return false;
  return (plan.residents || []).some((id) => sameLocalModel(id, modelId));
}
