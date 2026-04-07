/**
 * @file hfOptimize.js
 * @description Fetch optimal inference settings from Hugging Face (and Ollama registry as fallback).
 * Used by the Intel panel "Optimize" flow: HF API + README parsing for context_length, temperature,
 * top_p, top_k, repeat_penalty, etc. Exposes getHfModelUrl/getHfSearchUrl for "Look up" in browser.
 * Fallback: askModelForOptimalSettings() uses the largest loaded model to suggest settings.
 */

import { requestChatCompletion } from '$lib/api.js';
import { findLargestModel } from '$lib/utils/modelSelection.js';

const HF_BASE = typeof import.meta !== 'undefined' && import.meta.env?.DEV ? '/api/hf' : 'https://huggingface.co';
const HF_API = `${HF_BASE}/api`;

/** Minimum ms to show "Searching..." so user sees we're actually checking */
const MIN_SEARCH_MS = 1800;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Quantization suffixes to strip when resolving model name */
const QUANT_SUFFIXES = /\.(Q[2-8]_[KQ]?[SML]?|Q[2-8]_0|F16|F32)(\.gguf)?$/i;

/** Known GGUF uploaders whose repos typically have llama.cpp examples with optimal params */
const GGUF_AUTHORS = ['TheBloke', 'bartowski', 'QuantFactory'];

/**
 * Resolve LM Studio model ID to Hugging Face repo ID.
 * Tries: direct match, TheBloke/{name}-GGUF guess, then API search for GGUF models.
 * @param {string} modelId - e.g. "mistral-7b-instruct-v0.2.Q4_K_M" or "Mistral-7B-Instruct-v0.2-GGUF"
 * @returns {Promise<string|null>} HF repo id or null
 */
export async function resolveHfModelId(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  const trimmed = modelId.trim();
  if (!trimmed) return null;

  // Already looks like author/model
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    const res = await fetchModelInfo(trimmed);
    if (res?.id) return res.id;
  }

  // Build base name: strip .gguf and quantization
  let base = trimmed.replace(/\.gguf$/i, '').replace(QUANT_SUFFIXES, '');
  base = base.replace(/[-_]+/g, '-').replace(/\s+/g, '-');

  // Try TheBloke/{Name}-GGUF (common LM Studio display name pattern)
  const capped = base
    .split('-')
    .map((w) => {
      if (/^\d+[bkm]$/i.test(w)) return w.toUpperCase();
      if (/^v\d/i.test(w)) return w.toLowerCase();
      return w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join('-');
  const guess = `TheBloke/${capped}-GGUF`;
  const guessRes = await fetchModelInfo(guess);
  if (guessRes?.id) return guessRes.id;

  // Try bartowski as fallback
  const bartGuess = `bartowski/${capped}-GGUF`;
  const bartRes = await fetchModelInfo(bartGuess);
  if (bartRes?.id) return bartRes.id;

  // API search for GGUF models
  const searchTerms = base.split(/[\s_-]+/).filter(Boolean).slice(0, 6).join(' ');
  try {
    const searchRes = await fetch(
      `${HF_API}/models?search=${encodeURIComponent(searchTerms + ' gguf')}&limit=15`
    );
    if (!searchRes.ok) return null;
    const list = await searchRes.json();
    if (!Array.isArray(list) || list.length === 0) return null;

    const ggufList = list.filter((m) => (m.tags || []).includes('gguf') || /gguf/i.test(m.modelId || m.id || ''));
    if (ggufList.length > 0) {
      const byAuthor = ggufList.find((m) => GGUF_AUTHORS.some((a) => (m.modelId || m.id || '').startsWith(a + '/')));
      return (byAuthor || ggufList[0])?.modelId || ggufList[0]?.id || null;
    }
    return list[0]?.modelId || list[0]?.id || null;
  } catch (_) {
    return null;
  }
}

/** Get Hugging Face model page URL for opening in browser. */
export function getHfModelUrl(repoId) {
  if (!repoId) return null;
  return `https://huggingface.co/${repoId.replace(/\/$/, '')}`;
}

/** Get Hugging Face models search URL for a query. */
export function getHfSearchUrl(query) {
  const q = (query || '').trim().replace(/\s+/g, '+');
  return `https://huggingface.co/models?search=${encodeURIComponent(q)}`;
}

/**
 * Fetch model info from HF API.
 * @param {string} repoId - e.g. "TheBloke/Mistral-7B-Instruct-v0.2-GGUF"
 * @returns {Promise<object|null>}
 */
async function fetchModelInfo(repoId) {
  try {
    const res = await fetch(`${HF_API}/models/${encodeURIComponent(repoId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/**
 * Fetch README raw content.
 * @param {string} repoId
 * @returns {Promise<string>}
 */
async function fetchReadme(repoId) {
  try {
    const res = await fetch(`${HF_BASE}/${encodeURIComponent(repoId)}/raw/main/README.md`);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Parse README for optimal settings (llama.cpp examples, Python examples, etc.).
 * Extracts any params the model card recommends.
 * @param {string} readme
 * @returns {Object}
 */
function parseReadmeSettings(readme) {
  const out = {};
  if (!readme || typeof readme !== 'string') return out;

  // llama.cpp style: -c 32768 --temp 0.7 --repeat_penalty 1.1 (or --repeat\_penalty in markdown)
  const ctxMatch = readme.match(/-c\s+(\d+)/);
  if (ctxMatch) {
    const v = parseInt(ctxMatch[1], 10);
    if (Number.isFinite(v) && v > 0) out.context_length = v;
  }

  const tempMatch = readme.match(/(?:--temp|-t)\s+([\d.]+)/);
  if (tempMatch) {
    const v = parseFloat(tempMatch[1]);
    if (Number.isFinite(v)) out.temperature = v;
  }

  const rpMatch = readme.match(/--repeat[_\\]?penalty\s+([\d.]+)/);
  if (rpMatch) {
    const v = parseFloat(rpMatch[1]);
    if (Number.isFinite(v)) out.repeat_penalty = v;
  }

  const topPMatch = readme.match(/(?:--top[-_]?p|top[-_]?p)\s*[:=]\s*([\d.]+)/);
  if (topPMatch) {
    const v = parseFloat(topPMatch[1]);
    if (Number.isFinite(v)) out.top_p = v;
  }

  const topKMatch = readme.match(/(?:--top[-_]?k|top[-_]?k)\s*[:=]\s*(\d+)/);
  if (topKMatch) {
    const v = parseInt(topKMatch[1], 10);
    if (Number.isFinite(v)) out.top_k = v;
  }

  // Python: n_ctx=32768, n_threads=8
  const nCtxMatch = readme.match(/n_ctx\s*=\s*(\d+)/);
  if (nCtxMatch && !out.context_length) {
    const v = parseInt(nCtxMatch[1], 10);
    if (Number.isFinite(v) && v > 0) out.context_length = v;
  }

  const nThreadsMatch = readme.match(/n_threads\s*=\s*(\d+)/);
  if (nThreadsMatch) {
    const v = parseInt(nThreadsMatch[1], 10);
    if (Number.isFinite(v) && v > 0) out.cpu_threads = v;
  }

  const nGpuMatch = readme.match(/n_gpu_layers\s*=\s*(\d+)/);
  if (nGpuMatch) {
    const v = parseInt(nGpuMatch[1], 10);
    if (Number.isFinite(v) && v >= 0) out.n_gpu_layers = v;
  }

  // Batch size if mentioned
  const batchMatch = readme.match(/(?:batch_size|eval_batch_size)\s*[:=]\s*(\d+)/i);
  if (batchMatch) {
    const v = parseInt(batchMatch[1], 10);
    if (Number.isFinite(v) && v > 0) out.eval_batch_size = v;
  }

  return out;
}

/**
 * Extract optional system/instruction prompt from README if present.
 * Looks for common sections. Returns null if nothing useful found.
 * @param {string} readme
 * @returns {string|null}
 */
function parseReadmePrompt(readme) {
  if (!readme || typeof readme !== 'string') return null;

  // Prompt template block (markdown code block)
  const templateBlock = readme.match(/(?:##\s*Prompt\s*template|##\s*Instruction\s*format)[\s\S]*?```[^`]*\n([\s\S]*?)```/i);
  if (templateBlock) {
    const content = templateBlock[1].trim();
    if (content.length > 10 && content.length < 2000) return content;
  }

  return null;
}

const OLLAMA_BASE = typeof import.meta !== 'undefined' && import.meta.env?.DEV ? '/api/ollama' : 'https://registry.ollama.ai';

/**
 * Try Ollama registry for context_length (fallback when HF has nothing).
 * @param {string} modelId - LM Studio model ID
 * @returns {Promise<{ settings: Object, source: string }|null>}
 */
async function tryOllamaLibrary(modelId) {
  const result = { settings: {}, source: '' };
  const lower = (modelId || '').toLowerCase();
  const fam = /llama|mistral|qwen|phi|gemma|deepseek|ministral/i.exec(lower)?.[0] || '';

  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return null;
    const data = await res.json();
    const models = (data.models || []).filter((m) => (m.name || '').toLowerCase().includes(fam || lower.slice(0, 8)));
    const match = models[0];
    if (!match) return null;
    result.source = `Ollama: ${match.name}`;
    result.settings.context_length = 4096;
    return result;
  } catch (_) {
    return null;
  }
}

/**
 * Fetch all optimal settings for a model from Hugging Face (and Ollama as fallback).
 * @param {string} modelId - LM Studio model ID
 * @returns {Promise<{ settings: Object, prompt: string|null, source: string, readme?: string, error?: string }>}
 */
export async function fetchOptimalSettings(modelId) {
  const result = { settings: {}, prompt: null, source: '', readme: undefined, error: null };

  const hfId = await resolveHfModelId(modelId);
  if (!hfId) {
    const ollama = await tryOllamaLibrary(modelId);
    if (ollama && Object.keys(ollama.settings).length > 0) {
      Object.assign(result.settings, ollama.settings);
      result.source = ollama.source;
      return result;
    }
    result.error = 'Could not find model on Hugging Face or Ollama. The model may not be listed there, or check your connection.';
    return result;
  }

  result.source = hfId;

  const [info, readme] = await Promise.all([fetchModelInfo(hfId), fetchReadme(hfId)]);

  if (readme && readme.length > 0) result.readme = readme;

  if (info) {
    const card = info.cardData || {};
    const gguf = info.gguf || {};

    if (typeof gguf.context_length === 'number') {
      result.settings.context_length = gguf.context_length;
    }

    if (card.prompt_template && typeof card.prompt_template === 'string') {
      const pt = card.prompt_template.trim();
      const looksLikeInstruction = /^(You|The|Follow|Be|Always|Never|Act|Role|System)\b/i.test(pt) || /\b(assistant|instruction|behaviour|behavior)\b/i.test(pt);
      if (pt.length > 20 && looksLikeInstruction) result.prompt = pt;
    }
  }

  const fromReadme = parseReadmeSettings(readme);
  Object.assign(result.settings, fromReadme);

  const readmePrompt = parseReadmePrompt(readme);
  if (readmePrompt && !result.prompt) result.prompt = readmePrompt;

  return result;
}

/**
 * Fetch optimal settings with minimum delay so user sees we're checking.
 * @param {string} modelId
 * @returns {Promise<{ settings: Object, prompt: string|null, source: string, readme?: string, error?: string }>}
 */
export async function fetchOptimalSettingsWithDelay(modelId) {
  const [result] = await Promise.all([fetchOptimalSettings(modelId), delay(MIN_SEARCH_MS)]);
  return result;
}

/**
 * Parse LLM response text for inference settings (temperature, top_p, context_length, etc.).
 * Handles JSON blocks, key: value, - key: value, bullet lists, etc.
 * @param {string} text
 * @returns {Object}
 */
function parseLlmResponseForSettings(text) {
  const out = {};
  if (!text || typeof text !== 'string') return out;

  const lower = text.toLowerCase();

  const patterns = [
    { key: 'temperature', regex: /temperature\s*[:=]\s*([\d.]+)/i, parse: (v) => parseFloat(v) },
    { key: 'top_p', regex: /top[-_]?p\s*[:=]\s*([\d.]+)/i, parse: (v) => parseFloat(v) },
    { key: 'top_k', regex: /top[-_]?k\s*[:=]\s*(\d+)/i, parse: (v) => parseInt(v, 10) },
    { key: 'context_length', regex: /context[-_\s]*(?:length|size|window)\s*[:=]\s*(\d+)/i, parse: (v) => parseInt(v, 10) },
    { key: 'repeat_penalty', regex: /repeat[-_]?penalty\s*[:=]\s*([\d.]+)/i, parse: (v) => parseFloat(v) },
    { key: 'eval_batch_size', regex: /(?:eval[-_]?)?batch[-_\s]?size\s*[:=]\s*(\d+)/i, parse: (v) => parseInt(v, 10) },
    { key: 'cpu_threads', regex: /(?:cpu[-_]?)?threads\s*[:=]\s*(\d+)/i, parse: (v) => parseInt(v, 10) },
    { key: 'context_length', regex: /(\d+)\s*(?:tokens?|context)/i, parse: (v) => parseInt(v, 10) },
  ];

  for (const { key, regex, parse } of patterns) {
    if (out[key] != null) continue;
    const m = text.match(regex);
    if (m) {
      const v = parse(m[1]);
      if (Number.isFinite(v) && v > 0) out[key] = v;
    }
  }

  if (!out.temperature && /temperature\s+([\d.]+)/i.test(text)) {
    const m = text.match(/temperature\s+([\d.]+)/i);
    if (m) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v)) out.temperature = v;
    }
  }

  if (!out.context_length && /(\d+)\s*(?:max[-_\s]?context|context[-_\s]?length)/i.test(text)) {
    const m = text.match(/(\d+)\s*(?:max[-_\s]?context|context[-_\s]?length)/i);
    if (m) {
      const v = parseInt(m[1], 10);
      if (Number.isFinite(v) && v > 0) out.context_length = v;
    }
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj.temperature != null) out.temperature = Number(obj.temperature);
      if (obj.top_p != null) out.top_p = Number(obj.top_p);
      if (obj.top_k != null) out.top_k = Number(obj.top_k);
      if (obj.context_length != null) out.context_length = Number(obj.context_length);
      if (obj.repeat_penalty != null) out.repeat_penalty = Number(obj.repeat_penalty);
    }
  } catch (_) {}

  return out;
}

function parseLlmResponseForPrompt(text) {
  if (!text || typeof text !== 'string') return null;
  const systemMatch = text.match(/system[_\s]?prompt\s*[:=]\s*["']([^"']+)["']/i);
  if (systemMatch && systemMatch[1].length > 10) return systemMatch[1].trim();
  const youAreMatch = text.match(/(You are[^.]{10,300}\.)/);
  if (youAreMatch && youAreMatch[1].length > 15) return youAreMatch[1].trim();
  const blockMatch = text.match(/```[\s\S]*?\n([\s\S]{20,500})```/);
  if (blockMatch && /you are|assistant|helpful/i.test(blockMatch[1])) return blockMatch[1].trim();
  return null;
}

/**
 * Ask your smartest loaded model for optimal inference settings and system prompt for a target model.
 * Fallback when Hugging Face has no settings.
 * @param {string} targetModelName - Model we're optimizing (e.g. "Mistral-7B-Instruct-v0.2-GGUF")
 * @param {string[]} modelIds - Available model ids (e.g. from models store)
 * @returns {Promise<{ settings: Object, prompt?: string, error?: string }>}
 */
export async function askModelForOptimalSettings(targetModelName, modelIds) {
  const advisorModel = findLargestModel(modelIds || []);
  if (!advisorModel) {
    return { settings: {}, error: 'No model loaded. Load a model in LM Studio first.' };
  }

  const prompt = `What are the recommended inference settings for the LLM "${targetModelName}"? Provide temperature, top_p, top_k, context_length (or max context), and repeat_penalty if applicable. Also suggest a good system prompt for this model. Reply with a JSON object or simple key: value pairs. Include "system_prompt": "your suggested prompt" if you know one. Be concise.`;

  try {
    const { content } = await requestChatCompletion({
      model: advisorModel,
      messages: [
        { role: 'system', content: 'You are an expert on LLM inference. Reply only with settings and optionally a system prompt.' },
        { role: 'user', content: prompt },
      ],
      options: { temperature: 0.2, max_tokens: 512 },
    });

    const settings = parseLlmResponseForSettings(content);
    const suggestedPrompt = parseLlmResponseForPrompt(content);
    if (Object.keys(settings).length === 0) {
      return { settings: {}, error: 'Could not parse settings from response.' };
    }
    return { settings, prompt: suggestedPrompt || undefined };
  } catch (e) {
    return { settings: {}, error: e?.message || 'Failed to ask model.' };
  }
}
