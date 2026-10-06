import { modelSupportsThinking } from '$lib/thinkingControls.js';
import { isLocalAtomModel, matchOpenRouterModel } from '$lib/modelPricing.js';
import { getModelTypeTag } from '$lib/cloudCatalog.js';

/**
 * Capability flags carried on a llama.cpp / LM Studio model row.
 * llama.cpp advertises vision as `architecture.input_modalities`, `/props.modalities`,
 * or `/models` `capabilities: ["multimodal"]`. Empty fields mean unknown, not "no vision".
 * @param {object|null|undefined} row
 * @returns {{ vision: boolean }|null}
 */
export function endpointCapsFromRow(row) {
  if (!row || typeof row !== 'object') return null;
  const arch = row.architecture && typeof row.architecture === 'object' ? row.architecture : null;
  const ins = Array.isArray(arch?.input_modalities)
    ? arch.input_modalities.map((x) => String(x).toLowerCase())
    : [];
  const modality = String(arch?.modality || '').toLowerCase();
  const mods = row.modalities && typeof row.modalities === 'object' ? row.modalities : null;
  const caps = Array.isArray(row.capabilities)
    ? row.capabilities.map((x) => String(x).toLowerCase())
    : [];
  const fromArch = !!(ins.length || modality);
  const fromMods = !!(mods && ('vision' in mods || 'video' in mods || 'image' in mods));
  const fromCaps = caps.includes('multimodal') || caps.includes('vision') || caps.includes('image') || caps.includes('video');
  if (!fromArch && !fromMods && !fromCaps) return null;
  const inputSide = modality.split('->')[0] || '';
  let vision = false;
  if (fromMods) {
    vision = mods.vision === true || mods.video === true || mods.image === true;
  } else {
    vision =
      ins.includes('image') ||
      ins.includes('video') ||
      /image|video/.test(inputSide) ||
      fromCaps;
  }
  return { vision };
}

/**
 * Flags from an OpenRouter catalog row the app already fetched for prices.
 * A missing field stays unknown so we do not invent a mark.
 * @param {object|null|undefined} hit
 */
export function openRouterCapabilityFlags(hit) {
  if (!hit || typeof hit !== 'object') return null;
  const params = Array.isArray(hit.supported_parameters)
    ? hit.supported_parameters.map((x) => String(x).toLowerCase())
    : null;
  const arch = hit.architecture && typeof hit.architecture === 'object' ? hit.architecture : null;
  const ins = Array.isArray(arch?.input_modalities)
    ? arch.input_modalities.map((x) => String(x).toLowerCase())
    : [];
  const modality = String(arch?.modality || '').toLowerCase();
  const visionKnown = !!(arch && (ins.length || modality));
  const inputSide = modality.split('->')[0] || '';
  const vision = visionKnown && (ins.includes('image') || ins.includes('video') || /image|video/.test(inputSide));
  const toolsKnown = !!params;
  const tools = toolsKnown && (params.includes('tools') || params.includes('tool_choice'));
  const thinkingKnown = hit.reasoning != null || !!params;
  const thinking =
    thinkingKnown &&
    (hit.reasoning != null ||
      params.includes('reasoning') ||
      params.includes('include_reasoning') ||
      params.includes('reasoning_effort'));
  return { vision, visionKnown, tools, toolsKnown, thinking, thinkingKnown };
}

function catalogIndex(catalog) {
  if (!catalog) return null;
  if (catalog.index?.byId) return catalog.index;
  if (catalog.byId) return catalog;
  return null;
}

/**
 * @param {string} modelId
 * @param {{ index?: { byId: Map<string, object> } }|null} [catalog] pricing catalog (OpenRouter rows)
 * @param {{ vision?: boolean }|null} [endpointCaps] flags kept from the model list row
 * @returns {{ vision: boolean, tools: boolean, thinking: boolean, json: boolean }}
 */
export function getModelCapabilities(modelId, catalog = null, endpointCaps = null) {
  if (!modelId || typeof modelId !== 'string') return { vision: false, tools: false, thinking: false, json: false };
  const lower = modelId.toLowerCase();
  // Vision / multimodal (images, video) — name heuristic used when the list row has no architecture.
  let vision =
    /\b(vl|vision|vlm|multimodal)\b/.test(lower) ||
    /llava|qwen2[-.]?vl|qwen2\.5[-.]?vl|qwen3[-.]?vl|minicpm[-.]?v|phi[-.]?3[-.]?vision|idefics|paligemma|pixtral|moondream|cogvlm|minigpt|gpt[-.]?4o|claude[-.]?3[-.]?5[-.]?sonnet|gemini[-.]?pro[-.]?vision|ministral|glm[-.]?4.*v|glm.*[-.]v|muse[-.]?glimmer|mimo[-_.]?v?2/i.test(lower);
  // Tools / function calling
  let tools =
    /\b(tool|tools|fc|function[-.]?call|agent)\b/.test(lower) ||
    /qwen2\.5|qwen2\.7|qwen3|llama[-.]?3\.1|llama[-.]?3\.2|llama[-.]?4|claude|gpt[-.]?4|mistral[-.]?large|command[-.]?r|deepseek|gemma|phi[-.]?4|minicpm|yi[-.]?1\.5|yi[-.]?2|schematron|ministral|glm[-.]?4|grok|mimo[-_.]?v?2/i.test(lower);
  let thinking = modelSupportsThinking(modelId);
  // JSON / structured output
  let json = /\bjson\b/.test(lower) || /schematron/i.test(lower);

  // Server architecture is per-file. Name heuristics miss image-capable GGUFs whose ids omit "vl".
  // Explicit flags already stored on the row (from the model list) are data, not guesses.
  if (endpointCaps && typeof endpointCaps === 'object') {
    if (endpointCaps.vision) vision = true;
    if (endpointCaps.tools) tools = true;
    if (endpointCaps.thinking) thinking = true;
    if (endpointCaps.json) json = true;
  }

  // Cloud rows: OpenRouter architecture + supported_parameters already downloaded with prices.
  if (!isLocalAtomModel(modelId)) {
    const index = catalogIndex(catalog);
    const flags = openRouterCapabilityFlags(index ? matchOpenRouterModel(modelId, index) : null);
    if (flags?.visionKnown && flags.vision) vision = true;
    if (flags?.toolsKnown && flags.tools) tools = true;
    if (flags?.thinkingKnown && flags.thinking) thinking = true;
  }

  // Type tags the selector already computes (Reasoning, Video, Image, Multimodal).
  // Chat / Fast / Latest / Legacy are not capability types and do not get an icon.
  const tag = String(getModelTypeTag(modelId) || '').trim().toLowerCase();
  if (tag === 'video' || tag === 'image' || tag === 'multimodal' || tag === 'vision') vision = true;
  if (tag === 'reasoning' || tag === 'reasoner' || tag === 'thinking') thinking = true;

  return { vision, tools, thinking, json };
}

/**
 * Same as getModelCapabilities, using caps already stored on a listed model row.
 * @param {string} modelId
 * @param {Array<{ id?: string, caps?: object }>|null|undefined} listedModels
 * @param {{ index?: { byId: Map<string, object> } }|null} [catalog]
 */
export function listedModelCaps(modelId, listedModels, catalog = null) {
  const row = Array.isArray(listedModels)
    ? listedModels.find((m) => m && m.id === modelId)
    : null;
  return getModelCapabilities(modelId, catalog, row?.caps || null);
}
