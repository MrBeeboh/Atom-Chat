/**
 * Cloud image + video generation (DeepSeek/Together/DeepInfra). Extracted from api.js.
 */
import { getBaseAndAuth, CLOUD_REQUEST_TIMEOUT_MS } from '$lib/apiConfig.js';
import { parseChatApiError } from '$lib/chatErrorUtils.js';

/** DeepSeek does NOT have a native image generation API (they only analyze images). Endpoint below does not exist; kept for possible future proxy (e.g. Together AI). */
const DEEPSEEK_IMAGES_GENERATIONS_URL = 'https://api.deepseek.com/v1/images/generations';

/** Together.xyz image generation: separate endpoint for DeepSeek path (DeepSeek has no native image API). Do not use for Grok. */
const TOGETHER_IMAGES_GENERATIONS_URL = 'https://api.together.xyz/v1/images/generations';

/** DeepInfra inference base (image + video). Per official docs: https://api.deepinfra.com/v1/inference/{model_id} */
const DEEPINFRA_INFERENCE_BASE = 'https://api.deepinfra.com/v1/inference';

/**
 * DeepSeek image generation. NOTE: DeepSeek has no native /v1/images/generations; this would 404. Kept for future use if we proxy to Together AI etc.
 * @param {{ prompt: string, n?: number, size?: string, quality?: string, response_format?: string }} opts
 * @returns {Promise<{ data: Array<{ url?: string, b64_json?: string }> }>}
 */
export async function requestDeepSeekImageGeneration({
  prompt,
  n = 1,
  size = '1024x1024',
  quality = 'standard',
  response_format = 'url',
}) {
  const { headers: authHeaders } = getBaseAndAuth('deepseek:deepseek-chat');
  if (!authHeaders?.Authorization) throw new Error('DeepSeek API key required. Add it in Settings → Cloud APIs.');
  const body = {
    model: 'deepseek-image',
    prompt: String(prompt).trim(),
    n: Math.max(1, Math.min(10, Number(n) || 1)),
    size: size || '1024x1024',
    quality: quality || 'standard',
    response_format,
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(DEEPSEEK_IMAGES_GENERATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseChatApiError(res.status, text, 'deepseek:deepseek-image'));
    }
    return res.json();
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/**
 * Generate image via Together AI (used when DeepSeek is selected; different endpoint from DeepSeek chat).
 * Request format: model, prompt, width, height, steps, n, response_format.
 * @param {{ prompt: string, apiKey: string, model?: string, width?: number, height?: number, steps?: number, n?: number }} opts
 * @returns {Promise<{ data: Array<{ url?: string }> }>}
 */
export async function requestTogetherImageGeneration({
  prompt,
  apiKey,
  model = 'black-forest-labs/FLUX.1-schnell',
  width = 1024,
  height = 1024,
  steps = 4,
  n = 1,
}) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('Together API key required for image generation when using DeepSeek. Add it in Settings or .env.');
  const body = {
    model,
    prompt: String(prompt).trim(),
    width: Number(width) || 1024,
    height: Number(height) || 1024,
    steps: Math.max(1, Math.min(50, Number(steps) || 4)),
    n: Math.max(1, Math.min(4, Number(n) || 1)),
    response_format: 'url',
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(TOGETHER_IMAGES_GENERATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseChatApiError(res.status, text, 'together:image'));
    }
    return res.json();
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/**
 * Text-to-image via DeepInfra. Synchronous; returns base64 in response.images[0].
 * @param {{ apiKey: string, modelId: string, prompt: string, num_images?: number, num_inference_steps?: number, guidance_scale?: number, width?: number, height?: number, negative_prompt?: string }} opts
 * @returns {Promise<{ data: Array<{ url: string }> }>} data[].url are data URLs (data:image/png;base64,...) for display
 */
export async function requestDeepInfraImageGeneration({
  apiKey,
  modelId,
  prompt,
  num_images = 1,
  num_inference_steps = 30,
  guidance_scale = 7.5,
  width = 1024,
  height = 1024,
  negative_prompt,
}) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('DeepInfra API key required. Add it in Settings → Cloud APIs.');
  const body = {
    prompt: String(prompt).trim(),
    num_images: Math.max(1, Math.min(4, Number(num_images) || 1)),
    num_inference_steps: Math.max(1, Math.min(50, Number(num_inference_steps) || 30)),
    guidance_scale: Number(guidance_scale) || 7.5,
    width: Math.max(128, Math.min(2048, Number(width) || 1024)),
    height: Math.max(128, Math.min(2048, Number(height) || 1024)),
  };
  if (negative_prompt != null && String(negative_prompt).trim() !== '') body.negative_prompt = String(negative_prompt).trim();
  const url = `${DEEPINFRA_INFERENCE_BASE}/${modelId}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), CLOUD_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.detail?.error || data?.detail || JSON.stringify(data) || res.statusText;
      throw new Error(parseChatApiError(res.status, msg, 'deepinfra:image'));
    }
    const rawImages = data?.images ?? data?.result?.images ?? [];
    const images = Array.isArray(rawImages) ? rawImages : [];
    if (images.length === 0) throw new Error('DeepInfra image response had no images.');
    const urls = images.map((item) => {
      if (typeof item === 'string') {
        if (item.startsWith('data:') || item.startsWith('http://') || item.startsWith('https://')) return item;
        return `data:image/png;base64,${item}`;
      }
      if (item && typeof item === 'object' && typeof item.url === 'string') return item.url;
      return null;
    }).filter(Boolean);
    if (urls.length === 0) throw new Error('DeepInfra image response had no images.');
    return { data: urls.map((url) => ({ url })) };
  } catch (err) {
    clearTimeout(to);
    throw err;
  }
}

/**
 * Text-to-video via DeepInfra. Synchronous; returns relative path in response.video_url or response.videos. Full URL = base + path.
 * CRITICAL (DeepInfra docs): Video models accept ONLY the "prompt" field. ANY other field (width, height, duration, negative_prompt, etc.) causes "signal aborted without reason". Do not add or spread any options here.
 * @param {{ apiKey: string, modelId: string, prompt: string }} opts
 * @returns {Promise<{ videoUrl: string }>}
 */
export async function requestDeepInfraVideoGeneration({ apiKey, modelId, prompt }) {
  const key = (apiKey || '').trim();
  if (!key) throw new Error('DeepInfra API key required. Add it in Settings → Cloud APIs.');
  const promptOnly = String(prompt ?? '').trim();
  const url = `${DEEPINFRA_INFERENCE_BASE}/${modelId}`;
  const VIDEO_TIMEOUT_MS = 1200000; // 20 minutes — DeepInfra video takes 5–10+ min; webhooks need a backend so we wait
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), VIDEO_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt: promptOnly }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.detail?.error || data?.detail || JSON.stringify(data) || res.statusText;
      throw new Error(parseChatApiError(res.status, msg, 'deepinfra:video'));
    }
    // Different models return video in different fields. Try all known shapes.
    const candidates = [
      data?.video_url,
      data?.videos,
      data?.video,
      data?.output,
      data?.url,
      data?.result?.video_url,
      data?.result?.videos,
      data?.result?.video,
      data?.result?.output,
      data?.result?.url,
    ];
    let pathStr = null;
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) { pathStr = c.trim(); break; }
      if (Array.isArray(c) && c.length > 0) {
        const first = typeof c[0] === 'string' ? c[0] : c[0]?.url ?? c[0]?.video_url ?? null;
        if (typeof first === 'string' && first.trim()) { pathStr = first.trim(); break; }
      }
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const inner = c.url ?? c.video_url ?? c.video ?? null;
        if (typeof inner === 'string' && inner.trim()) { pathStr = inner.trim(); break; }
      }
    }
    if (!pathStr) throw new Error(`DeepInfra video: unexpected response shape. Keys: ${Object.keys(data || {}).join(', ')}`);
    const fullVideoUrl =
      pathStr.startsWith('data:') || pathStr.startsWith('http://') || pathStr.startsWith('https://')
        ? pathStr
        : `https://api.deepinfra.com${pathStr.startsWith('/') ? pathStr : `/${pathStr}`}`;
    return { videoUrl: fullVideoUrl };
  } catch (err) {
    clearTimeout(to);
    if (err?.name === 'AbortError') {
      throw new Error(`Video generation timed out after ${VIDEO_TIMEOUT_MS / 60000} minutes. Try again or use a shorter prompt.`);
    }
    throw err;
  }
}
