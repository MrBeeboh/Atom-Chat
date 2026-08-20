/**
 * Infer model capabilities from model id (name) for UI badges.
 * LM Studio does not expose capabilities in the API, so we use name heuristics.
 * Aligned with known model badges: llama-3.1, schematron, deepseek-r1, qwen3, phi-4-mini, ministral, glm-4.6v, qwen3-vl.
 * @param {string} modelId
 * @returns {{ vision: boolean, tools: boolean, thinking: boolean, json: boolean }}
 */
export function getModelCapabilities(modelId) {
  if (!modelId || typeof modelId !== 'string') return { vision: false, tools: false, thinking: false, json: false };
  const lower = modelId.toLowerCase();
  // Vision / multimodal (images, video)
  const vision =
    /\b(vl|vision|vlm|multimodal|mmproj|image[-.]?text|visual)\b/.test(lower) ||
    /llava|llama[-.]?3\.?2[-.]?vision|mllama|internvl|smolvlm|fuyu|aria[-.]?v|bunny[-.]?v|qwen2[-.]?vl|qwen2\.5[-.]?vl|qwen3[-.]?vl|qwen3\.5[-.]?vl|qwen[-.]?3\.5[-.]?vl|minicpm[-.]?v|phi[-.]?3[-.]?vision|idefics|paligemma|pixtral|moondream|cogvlm|minigpt|gpt[-.]?4o|claude[-.]?3[-.]?5[-.]?sonnet|gemini[-.]?pro[-.]?vision|ministral|glm[-.]?4.*v|glm.*[-.]v|gemma[-.]?3.*vision|kimi[-.]?vl|molmo|ovis/i.test(lower);
  // Tools / function calling
  const tools =
    /\b(tool|tools|fc|function[-.]?call|agent)\b/.test(lower) ||
    /qwen2\.5|qwen2\.7|qwen3|qwen3\.5|llama[-.]?3\.1|llama[-.]?3\.2|llama[-.]?4|claude|gpt[-.]?4|mistral[-.]?large|command[-.]?r|deepseek|gemma|phi[-.]?4|minicpm|yi[-.]?1\.5|yi[-.]?2|schematron|ministral|glm[-.]?4|grok/i.test(lower);
  // Thinking / reasoning (extended chain-of-thought, R1-style, deep thinking)
  const thinking =
    /\b(thinking|reasoning|chain[-.]?of[-.]?thought|cot)\b/.test(lower) ||
    /[-.]r1[-.]|deepseek[-.]?r1|phi[-.]?4[-.]?mini|qwen3[-.]?4b|qwen3\.5|glm[-.]?4|minicpm[-.]?v/i.test(lower) ||
    (/grok[-.]?4/i.test(lower) && !/non[-.]?reasoning/i.test(lower));
  // JSON / structured output
  const json = /\bjson\b/.test(lower) || /schematron/i.test(lower);
  return { vision, tools, thinking, json };
}
