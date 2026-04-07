/**
 * Fetch model config from Hugging Face to get creator-recommended defaults
 * (e.g. max_position_embeddings for context length).
 * LM Studio model ids often resemble HF repo names; we try to guess the HF id.
 */

/** Map LM Studio–style name patterns to Hugging Face repo ids (without quantization suffix). */
const HF_MODEL_GUESSES = [
  { pattern: /qwen2\.?5?-?(\d+b)/i, repo: (m) => `Qwen/Qwen2.5-${m[1]}-Instruct` },
  { pattern: /qwen2-?(\d+b)/i, repo: (m) => `Qwen/Qwen2-${m[1]}-Instruct` },
  { pattern: /llama-?3\.?2?-?(\d+b)/i, repo: (m) => `meta-llama/Llama-3.2-${m[1]}-Instruct` },
  { pattern: /llama-?3-?(\d+b)/i, repo: (m) => `meta-llama/Llama-3-${m[1]}-Instruct` },
  { pattern: /phi-?3/i, repo: () => `microsoft/Phi-3-mini-4k-instruct` },
  { pattern: /mistral-?(\d+b)/i, repo: () => `mistralai/Mistral-7B-Instruct-v0.3` },
  { pattern: /gemma-?2?-?(\d+b)/i, repo: (m) => `google/gemma-2-${m[1]}-it` },
  { pattern: /deepseek/i, repo: () => `deepseek-ai/DeepSeek-V3` },
  { pattern: /ernie\s*[34]?\.?\s*5/i, repo: () => `baidu/ERNIE-4.5-0.3B-PT` },
  { pattern: /ernie\s*[34]?/i, repo: () => `PaddlePaddle/ernie-3.5-tiny` },
  { pattern: /minicpm[-.]?v[-.]?4[-_]?5/i, repo: () => `openbmb/MiniCPM-V-4_5` },
  { pattern: /minicpm[-.]?v/i, repo: () => `openbmb/MiniCPM-V-2_6` },
  { pattern: /minicpm/i, repo: () => `openbmb/MiniCPM-V-4_5` },
];

/**
 * Guess a Hugging Face repo id from an LM Studio model id.
 * @param {string} lmStudioId - e.g. "Qwen2.5-7B-Instruct-Q4_K_M"
 * @returns {string|null} - e.g. "Qwen/Qwen2.5-7B-Instruct" or null
 */
export function guessHfModelId(lmStudioId) {
  if (!lmStudioId || typeof lmStudioId !== 'string') return null;
  for (const { pattern, repo } of HF_MODEL_GUESSES) {
    const match = lmStudioId.match(pattern);
    if (match) return repo(match);
  }
  return null;
}

const HF_RAW = 'https://huggingface.co';

/**
 * Fetch config.json from a Hugging Face repo.
 * @param {string} repoId - e.g. "Qwen/Qwen2.5-7B-Instruct"
 * @returns {Promise<{ max_position_embeddings?: number, [key: string]: unknown } | null>}
 */
export async function fetchModelConfig(repoId) {
  if (!repoId) return null;
  const url = `${HF_RAW}/${repoId.replace(/\/$/, '')}/raw/main/config.json`;
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

/**
 * Get creator-recommended context length (and any other useful defaults) from Hugging Face.
 * @param {string} lmStudioId
 * @returns {Promise<{ context_length?: number }>}
 */
export async function getRecommendedFromHf(lmStudioId) {
  const hfId = guessHfModelId(lmStudioId);
  if (!hfId) return {};
  const config = await fetchModelConfig(hfId);
  if (!config) return {};
  const maxPos = config.max_position_embeddings ?? config.max_sequence_length;
  if (typeof maxPos !== 'number') return {};
  return { context_length: maxPos };
}

const HF_API = 'https://huggingface.co/api';

/**
 * Search Hugging Face models. Used when we don't have a pattern match for LM Studio id.
 * @param {string} query - e.g. "ernie 5"
 * @param {{ limit?: number, pipelineTag?: string }} [opts]
 * @returns {Promise<Array<{ modelId: string, downloads?: number, likes?: number }>>}
 */
export async function searchHfModels(query, opts = {}) {
  const limit = Math.min(Number(opts.limit) || 10, 20);
  const pipelineTag = opts.pipelineTag || 'text-generation';
  try {
    const params = new URLSearchParams({ search: query, limit: String(limit) });
    const res = await fetch(`${HF_API}/models?${params}`, { method: 'GET', mode: 'cors' });
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list
      .filter((m) => (m.pipeline_tag || '').toLowerCase() === pipelineTag || !pipelineTag)
      .slice(0, limit)
      .map((m) => ({ modelId: m.modelId || m.id, downloads: m.downloads || 0, likes: m.likes || 0 }));
  } catch {
    return [];
  }
}

/**
 * Fetch README from a Hugging Face repo and return the URL of the first image (markdown or HTML).
 * Relative image paths are resolved to absolute HF URLs.
 * If README has no image, fetch the model page and use the first card/avatar image (cdn-avatars).
 * @param {string} repoId - e.g. "Qwen/Qwen2.5-7B-Instruct"
 * @returns {Promise<string|null>} - Absolute image URL or null
 */
export async function fetchReadmeFirstImageUrl(repoId) {
  if (!repoId) return null;
  const base = `${HF_RAW}/${repoId.replace(/\/$/, '')}`;
  const readmeUrl = `${base}/raw/main/README.md`;
  try {
    const res = await fetch(readmeUrl, { method: 'GET', mode: 'cors' });
    if (res.ok) {
      const text = await res.text();
      // First markdown image: ![alt](url) - capture url (may be relative)
      const mdMatch = text.match(/!\[[^\]]*\]\s*\(\s*([^)\s]+)\s*\)/);
      if (mdMatch) {
        let url = mdMatch[1].trim();
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        if (url.startsWith('//')) return `https:${url}`;
        const path = url.replace(/^\.\//, '').replace(/^\//, '');
        return `${base}/resolve/main/${path}`;
      }
      // First HTML img src
      const imgMatch = text.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
      if (imgMatch) {
        let url = imgMatch[1].trim();
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        if (url.startsWith('//')) return `https:${url}`;
        const path = url.replace(/^\.\//, '').replace(/^\//, '');
        return `${base}/resolve/main/${path}`;
      }
    }
    // Fallback: model page often shows card/avatar image from cdn-avatars
    const pageRes = await fetch(base, { method: 'GET', mode: 'cors' });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();
    const cdnMatch = html.match(/https:\/\/cdn-avatars\.huggingface\.co\/[^\s"']+\.(?:png|jpg|jpeg|webp|svg)/i);
    if (cdnMatch) return cdnMatch[0];
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve LM Studio model id to a Hugging Face repo id: try pattern guess first, then API search.
 * Used to find the model on HF so we can fetch its card image.
 * @param {string} lmStudioId - e.g. "Ernie 5.0" or "Qwen2.5-7B-Instruct-Q4_K_M"
 * @returns {Promise<string|null>} - HF repo id or null
 */
export async function resolveHfRepoForIcon(lmStudioId) {
  if (!lmStudioId || typeof lmStudioId !== 'string') return null;
  const guessed = guessHfModelId(lmStudioId);
  if (guessed) return guessed;
  // Build search query: strip quantization suffixes and common suffixes, keep model name
  const cleaned = lmStudioId
    .replace(/\s*[-_]?\s*(Q[0-9][_\s-]*[Kk][_\s-]*[SsMmLl]?|GGUF|GPTQ|AWQ|fp16|bf16)\s*$/i, '')
    .replace(/\s*[-_]\s*(instruct|chat|base)\s*$/i, '')
    .trim();
  if (cleaned.length < 2) return null;
  const searchQuery = cleaned.replace(/[-_\s]+/g, ' ').trim().slice(0, 50);
  const results = await searchHfModels(searchQuery, { limit: 5, pipelineTag: 'text-generation' });
  if (results.length === 0) return null;
  // Prefer highest downloads
  const best = results.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))[0];
  return best?.modelId || null;
}
