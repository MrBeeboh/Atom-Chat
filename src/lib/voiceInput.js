/**
 * Voice input helpers shared by the dictate and open-mic flows in ChatInput.
 * Extracted so the URL resolution, health check, and transcription are single
 * definitions and unit-testable.
 */

export const DEFAULT_VOICE_SERVER_URL = 'http://localhost:8765';

/** Resolve the voice server base URL from a store value + localStorage fallback. */
export function resolveVoiceServerUrl(storeValue) {
  const baseUrl =
    storeValue ??
    (typeof localStorage !== 'undefined' ? localStorage.getItem('voiceServerUrl') : null) ??
    DEFAULT_VOICE_SERVER_URL;
  return String(baseUrl || '').trim().replace(/\/$/, '');
}

/** GET /health with a 3s timeout. Throws if the request fails. */
export async function checkVoiceServerHealth(url) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 3000);
  try {
    return await fetch(`${url}/health`, { method: 'GET', signal: ac.signal });
  } finally {
    clearTimeout(to);
  }
}

/** POST an audio blob to /transcribe and return the trimmed text. */
export async function transcribeBlob(blob, url) {
  const form = new FormData();
  form.append('audio', blob, 'audio.webm');
  const res = await fetch(`${url}/transcribe`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Server ${res.status}`);
  }
  const data = await res.json();
  return data && data.text ? String(data.text).trim() : '';
}

/** Approximate megabytes of a data-URL string (base64 → 3 bytes per 4 chars). */
export function estimateDataUrlMb(dataUrl) {
  return (String(dataUrl || '').length * 3) / 4 / 1024 / 1024;
}
