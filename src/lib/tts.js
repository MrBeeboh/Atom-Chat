/**
 * Read-aloud TTS for chat replies. Kokoro (DeepInfra) or browser fallback. Separate from Eve.
 */
import { get } from 'svelte/store';
import { requestDeepInfraKokoroSpeech } from '$lib/api.js';
import {
  openMicActive,
  ttsActiveMessageId,
  ttsEngine,
  ttsError,
  ttsKokoroVoice,
  ttsPreparing,
  ttsRate,
  ttsReadAloudEnabled,
  ttsVoiceUri,
  ttsVolume,
  voiceRoleplaySessionActive,
} from '$lib/stores.js';

export const KOKORO_VOICES = [
  { id: 'af_bella', label: 'Bella — warm (US female)' },
  { id: 'af_heart', label: 'Heart — upbeat (US female)' },
  { id: 'af_sarah', label: 'Sarah — professional (US female)' },
  { id: 'af_sky', label: 'Sky — bright (US female)' },
  { id: 'af_nicole', label: 'Nicole — soft (US female)' },
  { id: 'am_adam', label: 'Adam — friendly (US male)' },
  { id: 'am_michael', label: 'Michael — deep (US male)' },
  { id: 'bf_emma', label: 'Emma — proper (UK female)' },
  { id: 'bf_isabella', label: 'Isabella — soft (UK female)' },
  { id: 'bm_george', label: 'George — formal (UK male)' },
  { id: 'bm_lewis', label: 'Lewis — casual (UK male)' },
];

/** @returns {boolean} */
export function browserTtsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function getDeepinfraTtsKey() {
  const fromLs = typeof localStorage !== 'undefined' ? (localStorage.getItem('deepinfraApiKey') ?? '').trim() : '';
  return (
    fromLs ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DEEPINFRA_API_KEY) ||
    ''
  ).trim();
}

/** @returns {boolean} */
export function kokoroTtsAvailable() {
  return getDeepinfraTtsKey().length > 0;
}

/** Show the chat-bar speaker when any engine can run. */
export function readAloudAvailable() {
  if (get(ttsEngine) === 'kokoro') return kokoroTtsAvailable() || browserTtsSupported();
  return browserTtsSupported();
}

/** @deprecated use readAloudAvailable */
export function ttsSupported() {
  return readAloudAvailable();
}

/** @returns {SpeechSynthesisVoice[]} */
export function listBrowserVoices() {
  if (!browserTtsSupported()) return [];
  return speechSynthesis.getVoices();
}

export function resolveSpeechVoice(voices, storedUri = '') {
  const list = Array.isArray(voices) ? voices : [];
  const key = (storedUri || '').trim();
  if (key) {
    const exact = list.find((v) => v.voiceURI === key || v.name === key);
    if (exact) return exact;
  }
  const enLocal = list.find((v) => v.lang?.toLowerCase().startsWith('en') && v.localService);
  if (enLocal) return enLocal;
  const enAny = list.find((v) => v.lang?.toLowerCase().startsWith('en'));
  if (enAny) return enAny;
  return list[0] ?? null;
}

export function plainTextForSpeech(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let text = raw.replace(/<(?:think|reasoning|thought)>[\s\S]*?<\/(?:think|reasoning|thought)>/gi, ' ');
  text = text.replace(/\[Image: [^\]]+\]/g, ' ');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/^#+\s+/gm, '');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/[_~>#]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/** Split long replies into Kokoro-sized chunks at sentence boundaries. */
export function splitTextForTts(text, maxLen = 2200) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];
  const parts = [];
  let rest = trimmed;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('. ', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf(' ', maxLen);
    if (cut < 1) cut = maxLen;
    parts.push(rest.slice(0, cut + (rest[cut] === '.' ? 1 : 0)).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

let ttsGeneration = 0;
let kokoroWarmExpiresAt = 0;
let kokoroWarmInFlight = /** @type {Promise<void> | null} */ (null);

/** Pre-load Kokoro on DeepInfra so the first reply does not wait on cold start. */
export function warmUpKokoroTts() {
  if (get(ttsEngine) !== 'kokoro' || !kokoroTtsAvailable()) return Promise.resolve();
  if (Date.now() < kokoroWarmExpiresAt) return Promise.resolve();
  if (kokoroWarmInFlight) return kokoroWarmInFlight;
  const key = getDeepinfraTtsKey();
  kokoroWarmInFlight = requestDeepInfraKokoroSpeech({
    apiKey: key,
    text: 'Ready.',
    voice: get(ttsKokoroVoice) || 'af_bella',
    speed: get(ttsRate) || 1,
  })
    .then(() => {
      kokoroWarmExpiresAt = Date.now() + 8 * 60 * 1000;
    })
    .catch(() => {})
    .finally(() => {
      kokoroWarmInFlight = null;
    });
  return kokoroWarmInFlight;
}

/** Reused so playback stays unlocked after a user click. */
let sharedAudio = /** @type {HTMLAudioElement | null} */ (null);
/** @type {HTMLAudioElement | null} */
let currentAudio = null;
/** @type {string | null} */
let currentBlobUrl = null;
let unlockCtx = /** @type {AudioContext | null} */ (null);

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

/** Call from a click handler so later TTS is allowed to play. */
export function unlockAudioPlayback() {
  if (typeof window === 'undefined') return;
  try {
    if (!sharedAudio) sharedAudio = new Audio();
    sharedAudio.muted = true;
    sharedAudio.src = SILENT_WAV;
    sharedAudio.play().catch(() => {});
  } catch {
    /* ignore */
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      if (!unlockCtx) unlockCtx = new Ctx();
      unlockCtx.resume?.();
    }
  } catch {
    /* ignore */
  }
  if (browserTtsSupported()) {
    try {
      speechSynthesis.resume?.();
    } catch {
      /* ignore */
    }
  }
}

function clearAudioPlayback() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    try {
      currentAudio.removeAttribute('src');
      currentAudio.load();
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}

export function stopTts() {
  ttsGeneration += 1;
  ttsPreparing.set(false);
  if (browserTtsSupported()) speechSynthesis.cancel();
  clearAudioPlayback();
}

export function clampPlaybackVolume(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.8;
  return Math.max(0, Math.min(1, v));
}

export function getPlaybackVolume() {
  return clampPlaybackVolume(get(ttsVolume));
}

function applyPlaybackVolumeToAudio(audio) {
  if (!audio) return;
  const vol = getPlaybackVolume();
  audio.volume = vol;
  audio.muted = vol <= 0.001;
}

if (typeof window !== 'undefined') {
  ttsVolume.subscribe(() => applyPlaybackVolumeToAudio(currentAudio || sharedAudio));
}

export function isTtsSpeaking() {
  if (currentAudio && !currentAudio.paused) return true;
  return browserTtsSupported() && speechSynthesis.speaking;
}

/** True while Kokoro is fetching or any engine is playing. */
export function isTtsBusy() {
  return get(ttsPreparing) || !!get(ttsActiveMessageId) || isTtsSpeaking();
}

/**
 * Open mic always speaks replies. Typed chat only speaks when the speaker toggle is on.
 * Eve roleplay uses its own voice path.
 */
export function shouldAutoSpeakReply(opts = {}) {
  if (opts.roleplayActive ?? get(voiceRoleplaySessionActive)) return false;
  return !!(opts.readAloudEnabled ?? get(ttsReadAloudEnabled)) || !!(opts.openMicActive ?? get(openMicActive));
}

export function shouldReadAloudContent(content, modelId = '') {
  if (typeof modelId === 'string' && modelId.startsWith('grok-voice:')) return false;
  const text = plainTextForSpeech(content);
  if (!text || text.length < 3) return false;
  if (/^Generated (images|videos)/i.test(text)) return false;
  return true;
}

function speakBrowser(text, opts = {}) {
  if (!browserTtsSupported()) throw new Error('Browser read-aloud is not available.');
  speechSynthesis.cancel();
  const voices = listBrowserVoices();
  const voice = resolveSpeechVoice(voices, opts.voiceUri);
  const utter = new SpeechSynthesisUtterance(text);
  if (voice) utter.voice = voice;
  utter.rate = Math.max(0.5, Math.min(2, Number(opts.rate) || 1));
  utter.volume = getPlaybackVolume();
  utter.onend = () => opts.onEnd?.();
  utter.onerror = (ev) => {
    if (ev.error === 'interrupted' || ev.error === 'canceled') {
      opts.onEnd?.();
      return;
    }
    opts.onError?.(new Error(ev.error || 'Speech failed'));
  };
  speechSynthesis.speak(utter);
}

function playBlob(blob, gen) {
  return new Promise((resolve, reject) => {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    const url = URL.createObjectURL(blob);
    currentBlobUrl = url;
    const audio = sharedAudio || new Audio();
    sharedAudio = audio;
    currentAudio = audio;
    applyPlaybackVolumeToAudio(audio);
    audio.onended = () => {
      if (gen !== ttsGeneration) return;
      resolve(undefined);
    };
    audio.onerror = () => {
      if (gen !== ttsGeneration) return;
      reject(new Error('Audio playback failed'));
    };
    audio.src = url;
    audio.play().catch(reject);
  });
}

function fetchKokoroBlob(text, opts) {
  return requestDeepInfraKokoroSpeech({
    apiKey: getDeepinfraTtsKey(),
    text,
    voice: opts.kokoroVoice || 'af_bella',
    speed: opts.rate ?? 1,
  });
}

async function speakKokoro(text, opts = {}) {
  const key = getDeepinfraTtsKey();
  if (!key) throw new Error('DeepInfra API key required for Kokoro TTS.');
  const gen = ++ttsGeneration;
  ttsPreparing.set(true);
  const chunks = splitTextForTts(text);
  try {
    let nextFetch = fetchKokoroBlob(chunks[0], opts);
    for (let i = 0; i < chunks.length; i++) {
      if (gen !== ttsGeneration) return;
      const blob = await nextFetch;
      if (gen !== ttsGeneration) return;
      ttsPreparing.set(false);
      if (i + 1 < chunks.length) {
        nextFetch = fetchKokoroBlob(chunks[i + 1], opts);
      }
      await playBlob(blob, gen);
    }
  } finally {
    if (gen === ttsGeneration) ttsPreparing.set(false);
  }
}

/**
 * @param {string} text
 * @param {object} [opts]
 */
export async function speakPlainText(text, opts = {}) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Nothing to read aloud.');
  stopTts();
  const engine = opts.engine ?? get(ttsEngine);
  const useKokoro = engine === 'kokoro' && kokoroTtsAvailable();
  const browserOpts = {
    voiceUri: opts.voiceUri ?? get(ttsVoiceUri),
    rate: opts.rate ?? get(ttsRate),
    onEnd: opts.onEnd,
    onError: opts.onError,
  };
  if (useKokoro) {
    try {
      await speakKokoro(trimmed, {
        kokoroVoice: opts.kokoroVoice ?? get(ttsKokoroVoice),
        rate: opts.rate ?? get(ttsRate),
      });
      opts.onEnd?.();
      return;
    } catch (err) {
      if (!browserTtsSupported()) {
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    }
  }
  if (!browserTtsSupported()) {
    const err = new Error(
      engine === 'kokoro'
        ? 'Add a DeepInfra API key in Settings for Kokoro TTS.'
        : 'Read aloud is not supported in this browser.',
    );
    opts.onError?.(err);
    throw err;
  }
  speakBrowser(trimmed, browserOpts);
}

export function maybeReadAloudAssistantReply(content, messageId = '', modelId = '') {
  if (!shouldAutoSpeakReply()) return;
  if (!shouldReadAloudContent(content, modelId)) return;
  const text = plainTextForSpeech(content);
  ttsError.set(null);
  if (get(ttsEngine) === 'kokoro' && kokoroTtsAvailable()) warmUpKokoroTts();
  if (messageId) ttsActiveMessageId.set(messageId);
  speakPlainText(text, {
    voiceUri: get(ttsVoiceUri),
    kokoroVoice: get(ttsKokoroVoice),
    rate: get(ttsRate),
    engine: get(ttsEngine),
    onEnd: () => {
      if (!messageId || get(ttsActiveMessageId) === messageId) ttsActiveMessageId.set(null);
    },
    onError: (err) => {
      if (!messageId || get(ttsActiveMessageId) === messageId) ttsActiveMessageId.set(null);
      ttsError.set(err instanceof Error ? err.message : 'Read aloud failed');
    },
  }).catch((err) => {
    if (!messageId || get(ttsActiveMessageId) === messageId) ttsActiveMessageId.set(null);
    ttsError.set(err instanceof Error ? err.message : 'Read aloud failed');
  });
}
