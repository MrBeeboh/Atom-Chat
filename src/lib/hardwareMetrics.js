/**
 * Hardware metrics bridge (Python server) and DeepInfra Kokoro TTS. Extracted from api.js.
 */
import { viteEnvStr } from '$lib/apiConfig.js';

/** Default URL for hardware bridge (scripts/hardware_server.py). Override with localStorage 'hardwareMetricsUrl'. */
const DEFAULT_HARDWARE_URL = 'http://localhost:5000';

/**
 * Fetch hardware metrics from Python bridge (CPU, RAM, GPU util, VRAM). For floating metrics panel.
 * @returns {Promise<{ cpu_percent: number, ram_used_gb: number, ram_total_gb: number, gpu_util: number, vram_used_gb: number, vram_total_gb: number }|null>}
 */
export async function fetchHardwareMetrics() {
  let base = DEFAULT_HARDWARE_URL;
  if (typeof localStorage !== 'undefined') {
    const custom = localStorage.getItem('hardwareMetricsUrl');
    if (custom != null && String(custom).trim() !== '') base = String(custom).trim().replace(/\/$/, '');
  }
  const url = `${base}/metrics`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(t);
    return null;
  }
}

/**
 * DeepInfra inference URL. Dev uses the Vite proxy so the browser is not blocked by CORS.
 * @param {string} path
 */
export function deepinfraInferenceUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return `/api/deepinfra${p}`;
  return `https://api.deepinfra.com${p}`;
}

/**
 * Call DeepInfra Kokoro-82M TTS API for text-to-speech. Returns audio blob.
 * @param {{ apiKey: string, text: string, voice: string, speed?: number }} opts
 * @returns {Promise<Blob>}
 */
export async function requestDeepInfraKokoroSpeech({ apiKey, text, voice = 'af_bella', speed = 1 }) {
  const key = (apiKey || '').trim() || viteEnvStr('VITE_DEEPINFRA_API_KEY');
  if (!key) throw new Error('DeepInfra API key is required for Kokoro TTS.');
  const res = await fetch(deepinfraInferenceUrl('/v1/audio/speech'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'hexgrad/Kokoro-82M',
      input: text,
      voice,
      speed: Math.max(0.5, Math.min(2, Number(speed) || 1)),
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Kokoro TTS: ${res.status} ${res.statusText}${errText ? ' — ' + errText : ''}`);
  }
  return res.blob();
}
