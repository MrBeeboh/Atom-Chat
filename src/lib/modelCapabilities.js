/**
 * Infer model capabilities from model id (name) for UI badges.
 * LM Studio does not expose capabilities in the API, so we use name heuristics,
 * plus notes from llama-server architecture.input_modalities and sibling mmproj files.
 *
 * Qwen3.5+ is natively multimodal (image-text-to-text) even when the GGUF name
 * has no "VL" token — e.g. DavidAU/Qwen3.5-9B-The-Defiant-Fable-...-GGUF.
 */
import { ggufBasenameLower } from './localModelId.js';

/** @type {Set<string>} lowercase ids / basenames known to accept images */
const notedVisionKeys = new Set();

export function noteModelVisionCapability(id, hasVision) {
  if (!id || typeof id !== 'string' || !hasVision) return;
  notedVisionKeys.add(id.trim().toLowerCase());
  const base = ggufBasenameLower(id);
  if (base) notedVisionKeys.add(base);
}

export function clearNotedModelCapabilities() {
  notedVisionKeys.clear();
}

function notedVision(modelId) {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  if (notedVisionKeys.has(lower)) return true;
  const base = ggufBasenameLower(modelId);
  return Boolean(base && notedVisionKeys.has(base));
}

/**
 * Native multimodal Qwen 3.5+ (decimal minor). Plain Qwen3 / Qwen3-VL still use the VL heuristics.
 * @param {string} lower
 */
function isQwen35Family(lower) {
  return /qwen3\.\d/.test(lower) || /defiant[-_.]?fable/.test(lower);
}

/**
 * @param {string} modelId
 * @returns {{ vision: boolean, tools: boolean, thinking: boolean, json: boolean }}
 */
export function getModelCapabilities(modelId) {
  if (!modelId || typeof modelId !== 'string') return { vision: false, tools: false, thinking: false, json: false };
  const lower = modelId.toLowerCase();
  const qwen35 = isQwen35Family(lower);
  const vision =
    notedVision(modelId) ||
    qwen35 ||
    /\b(vl|vision|vlm|multimodal)\b/.test(lower) ||
    /llava|qwen2[-.]?vl|qwen2\.5[-.]?vl|qwen3[-.]?vl|minicpm[-.]?v|phi[-.]?3[-.]?vision|idefics|paligemma|pixtral|moondream|cogvlm|minigpt|gpt[-.]?4o|claude[-.]?3[-.]?5[-.]?sonnet|gemini[-.]?pro[-.]?vision|ministral|glm[-.]?4.*v|glm.*[-.]v/i.test(lower);
  const tools =
    qwen35 ||
    /\b(tool|tools|fc|function[-.]?call|agent)\b/.test(lower) ||
    /qwen2\.5|qwen2\.7|qwen3|llama[-.]?3\.1|llama[-.]?3\.2|llama[-.]?4|claude|gpt[-.]?4|mistral[-.]?large|command[-.]?r|deepseek|gemma|phi[-.]?4|minicpm|yi[-.]?1\.5|yi[-.]?2|schematron|ministral|glm[-.]?4|grok/i.test(lower);
  const thinking =
    qwen35 ||
    /\b(thinking|reasoning|chain[-.]?of[-.]?thought|cot)\b/.test(lower) ||
    /[-.]r1[-.]|deepseek[-.]?r1|phi[-.]?4[-.]?mini|qwen3[-.]?4b|glm[-.]?4|minicpm[-.]?v/i.test(lower) ||
    (/grok[-.]?4/i.test(lower) && !/non[-.]?reasoning/i.test(lower));
  const json = /\bjson\b/.test(lower) || /schematron/i.test(lower);
  return { vision, tools, thinking, json };
}
