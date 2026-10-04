/**
 * xAI Grok Voice Agent (Eve, etc.) — WebSocket realtime speech-to-speech.
 * Browser auth via ephemeral client secret; mic PCM16 in, assistant audio out.
 */
import { get } from 'svelte/store';
import { ttsVolume, micDeviceId } from '$lib/stores.js';
import { getPlaybackVolume, unlockAudioPlayback, ensureAudiblePlaybackVolume } from '$lib/tts.js';
import { acquireMicStream } from '$lib/micAccess.js';

const REALTIME_MODEL = 'grok-voice-latest';
const WS_URL = `wss://api.x.ai/v1/realtime?model=${REALTIME_MODEL}`;
const SUPPORTED_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000];
/** Docs default / recommended rate for grok-voice PCM. */
export const VOICE_SESSION_RATE = 24000;
const PLAYBACK_LEAD_S = 0.15;

export const XAI_VOICES = [
  { id: 'eve', label: 'Eve', description: 'Energetic, upbeat (default)' },
  { id: 'ara', label: 'Ara', description: 'Warm, friendly' },
  { id: 'rex', label: 'Rex', description: 'Confident, clear' },
  { id: 'sal', label: 'Sal', description: 'Smooth, balanced' },
  { id: 'leo', label: 'Leo', description: 'Authoritative, strong' },
];

export const DEFAULT_ROLEPLAY_INSTRUCTIONS = `You are Eve, an engaging voice roleplay partner. Stay in character, speak naturally and conversationally, and respond as if in a live scene with the user. Use expressive dialogue and emotional nuance suited to spoken conversation. Keep most replies to a few sentences unless the scene clearly needs more. Never break character unless the user asks you to.`;

/** True for realtime voice models (picker ids and persisted `grok-voice:eve` rows). */
export function isGrokVoiceModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  const s = modelId.toLowerCase();
  if (s.startsWith('grok-voice:')) return true;
  return /(?:^|[/:.])grok-voice(?:[-_./]|$)|voice-think-fast/.test(s);
}

/** Pick xAI session rate closest to the browser AudioContext rate. */
export function pickSessionSampleRate(nativeRate) {
  const n = Number(nativeRate) || 48000;
  return SUPPORTED_RATES.reduce(
    (best, r) => (Math.abs(r - n) < Math.abs(best - n) ? r : best),
    VOICE_SESSION_RATE,
  );
}

/**
 * @param {string} basePrompt
 * @param {string} [scenario]
 */
export function buildRoleplayInstructions(basePrompt, scenario = '') {
  const parts = [(basePrompt || DEFAULT_ROLEPLAY_INSTRUCTIONS).trim()];
  const scene = (scenario || '').trim();
  if (scene) parts.push(`Roleplay scenario and character notes:\n${scene}`);
  parts.push('Respond only with spoken dialogue and brief stage directions when helpful — no markdown, bullet lists, or meta commentary.');
  return parts.join('\n\n');
}

/** Join word-sized transcript deltas that arrive without a leading space. */
export function appendTranscriptDelta(existing, delta) {
  const next = typeof delta === 'string' ? delta : '';
  if (!next) return existing || '';
  const prev = existing || '';
  if (!prev) return next;
  if (/\s$/.test(prev) || /^\s/.test(next)) return prev + next;
  if (/[A-Za-z0-9)]$/.test(prev) && /^[A-Za-z0-9('"]/.test(next)) return `${prev} ${next}`;
  return prev + next;
}

function float32ToBase64PCM16(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function pcm16BytesToFloat32(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const sampleCount = Math.floor(src.length / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const lo = src[i * 2];
    const hi = src[i * 2 + 1];
    let val = lo | (hi << 8);
    if (val >= 0x8000) val -= 0x10000;
    float32[i] = val / 32768;
  }
  return float32;
}

function base64PCM16ToFloat32(base64String) {
  if (!base64String) return new Float32Array(0);
  const binaryString = atob(base64String);
  const byteLen = binaryString.length;
  const bytes = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) bytes[i] = binaryString.charCodeAt(i);
  return pcm16BytesToFloat32(bytes);
}

function resample(input, fromRate, toRate) {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

function isB64(v) {
  return typeof v === 'string' && v.length > 0;
}

/** Pull a base64 PCM16 string out of an audio event, tolerating several payload shapes. */
export function extractAudioDelta(event) {
  if (!event || typeof event !== 'object') return null;
  if (isB64(event.delta)) return event.delta;
  if (isB64(event.audio)) return event.audio;
  if (isB64(event.chunk)) return event.chunk;
  if (isB64(event.data)) return event.data;
  for (const key of ['output_audio', 'audio', 'delta']) {
    const nested = event[key];
    if (nested && typeof nested === 'object') {
      if (isB64(nested.delta)) return nested.delta;
      if (isB64(nested.audio)) return nested.audio;
      if (isB64(nested.data)) return nested.data;
      if (isB64(nested.chunk)) return nested.chunk;
    }
  }
  return null;
}

/** xAI client_secret payloads have used a few field names. */
export function extractVoiceClientToken(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.value === 'string' && data.value.trim()) return data.value.trim();
  if (typeof data.client_secret === 'string' && data.client_secret.trim()) return data.client_secret.trim();
  if (data.client_secret && typeof data.client_secret.value === 'string' && data.client_secret.value.trim()) {
    return data.client_secret.value.trim();
  }
  if (typeof data.secret === 'string' && data.secret.trim()) return data.secret.trim();
  if (typeof data.token === 'string' && data.token.trim()) return data.token.trim();
  return '';
}

/**
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function fetchVoiceClientSecret(apiKey) {
  if (!apiKey?.trim()) throw new Error('Grok (xAI) API key required for voice roleplay.');
  // Docs: this endpoint does not accept `session` or extra expires_after fields.
  const res = await fetch('/api/xai/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      expires_after: { seconds: 300 },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Voice session token: ${res.status} ${text || res.statusText}`);
  }
  const token = extractVoiceClientToken(await res.json());
  if (!token) throw new Error('Voice session token missing from xAI response.');
  return token;
}

/**
 * @typedef {Object} GrokVoiceCallbacks
 * @property {(state: 'connecting'|'connected'|'listening'|'speaking'|'disconnected'|'error') => void} [onState]
 * @property {(text: string) => void} [onUserTranscript]
 * @property {(delta: string, full: string) => void} [onAssistantTranscriptDelta]
 * @property {(text: string) => void} [onAssistantTranscriptDone]
 * @property {(chunks: number) => void} [onAudioChunks]
 * @property {(info: { audioChunks: number }) => void} [onTurnDone]
 * @property {(err: Error|string) => void} [onError]
 */

export class GrokVoiceSession {
  /** @param {GrokVoiceCallbacks} [callbacks] */
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    /** @type {WebSocket | null} */
    this.ws = null;
    /** @type {AudioContext | null} */
    this.audioContext = null;
    /** @type {GainNode | null} */
    this.outputGain = null;
    /** @type {MediaStream | null} */
    this.mediaStream = null;
    /** @type {ScriptProcessorNode | null} */
    this.processor = null;
    /** @type {MediaStreamAudioSourceNode | null} */
    this.source = null;
    /** @type {GainNode | null} */
    this.silentGain = null;
    this.micActive = false;
    this.micSendEnabled = true;
    this.connected = false;
    this.assistantTranscript = '';
    this.playbackTime = 0;
    this.sessionSampleRate = VOICE_SESSION_RATE;
    this.audioChunksPlayed = 0;
    /** @type {AudioBufferSourceNode[]} */
    this.scheduledSources = [];
    this._abort = false;
    this._volUnsub = /** @type {(() => void) | null} */ (null);
    this.responseInProgress = false;
    this.sessionReady = false;
    /** @type {{ resolve: (text: string) => void, reject: (err: Error) => void } | null} */
    this._textTurn = null;
    this._sessionWaitTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  }

  /** @param {GrokVoiceCallbacks['onState'] extends (...args: infer A) => void ? A[0] : never} state */
  _setState(state) {
    this.callbacks.onState?.(state);
  }

  async _initAudio() {
    unlockAudioPlayback();
    ensureAudiblePlaybackVolume(0.75);
    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new Ctx({ sampleRate: VOICE_SESSION_RATE });
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    this.sessionSampleRate = VOICE_SESSION_RATE;
    this.outputGain = this.audioContext.createGain();
    this.outputGain.gain.value = getPlaybackVolume();
    this.outputGain.connect(this.audioContext.destination);
    if (!this._volUnsub) {
      this._volUnsub = ttsVolume.subscribe(() => {
        if (this.outputGain) this.outputGain.gain.value = getPlaybackVolume();
      });
    }
    this.playbackTime = this.audioContext.currentTime + PLAYBACK_LEAD_S;
  }

  _buildSessionConfig(voice, instructions, scenario) {
    const rate = this.sessionSampleRate || VOICE_SESSION_RATE;
    return {
      voice,
      instructions: buildRoleplayInstructions(instructions, scenario),
      turn_detection: { type: 'server_vad', silence_duration_ms: 600 },
      reasoning: { effort: 'none' },
      audio: {
        input: {
          format: { type: 'audio/pcm', rate },
          transport: 'json',
        },
        output: {
          format: { type: 'audio/pcm', rate },
          transport: 'json',
        },
      },
    };
  }

  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} [opts.instructions]
   * @param {string} [opts.scenario]
   * @param {string} [opts.voice]
   * @param {boolean} [opts.captureMic]
   */
  async connect({ apiKey, instructions = '', scenario = '', voice = 'eve', captureMic = true }) {
    this._abort = false;
    this._setState('connecting');
    await this._initAudio();

    const sessionConfig = this._buildSessionConfig(voice, instructions, scenario);
    const token = await fetchVoiceClientSecret(apiKey);
    if (this._abort) return;

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL, [`xai-client-secret.${token}`]);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let settled = false;
      const t = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Voice WebSocket connection timed out'));
      }, 20000);

      const finishOk = () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        this.connected = true;
        this._setState('connected');
        resolve(undefined);
      };

      ws.onopen = () => {
        this._sessionWaitTimer = setTimeout(finishOk, 4000);
        this._send({ type: 'session.update', session: sessionConfig });
        if (this.audioContext?.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        reject(new Error('Voice WebSocket connection failed'));
      };
      ws.onclose = (ev) => {
        this.connected = false;
        if (!settled && !this._abort) {
          settled = true;
          clearTimeout(t);
          const reason = ev.reason ? `: ${ev.reason}` : '';
          reject(new Error(`Voice WebSocket closed (${ev.code}${reason})`));
          return;
        }
        if (!this._abort) this._setState('disconnected');
        this._finishTextTurn(this._abort ? null : new Error('Voice session closed'));
      };
      ws.onmessage = (ev) => {
        this._handleRawMessage(ev.data);
        if (!this.sessionReady) return;
        if (this._sessionWaitTimer) {
          clearTimeout(this._sessionWaitTimer);
          this._sessionWaitTimer = null;
        }
        if (!settled) finishOk();
      };
    });

    if (this._abort) {
      this.disconnect();
      return;
    }

    if (captureMic) await this.startMic();
  }

  /** @param {string} text */
  sendText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return Promise.reject(new Error('Nothing to say.'));
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Voice session is not connected.'));
    }
    return new Promise((resolve, reject) => {
      this._textTurn = { resolve, reject };
      this._send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: trimmed }],
        },
      });
      this._send({ type: 'response.create' });
    });
  }

  _finishTextTurn(error) {
    const turn = this._textTurn;
    this._textTurn = null;
    if (!turn) return;
    if (error) turn.reject(error instanceof Error ? error : new Error(String(error)));
    else turn.resolve(this.assistantTranscript);
  }

  /** @param {string | ArrayBuffer | Blob} data */
  _handleRawMessage(data) {
    if (data instanceof Blob) {
      data.arrayBuffer().then((buf) => this._playPcm16Bytes(new Uint8Array(buf))).catch(() => {});
      return;
    }
    if (data instanceof ArrayBuffer) {
      this._playPcm16Bytes(new Uint8Array(data));
      return;
    }
    if (typeof data !== 'string') return;
    this._handleJsonMessage(data);
  }

  /** @param {string} raw */
  _handleJsonMessage(raw) {
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    const type = typeof event.type === 'string' ? event.type : '';
    // Audio bytes can arrive under several names across API revisions.
    if (type.includes('audio') && !type.includes('transcript')) {
      const audio = extractAudioDelta(event);
      if (audio) {
        this._playAudioDelta(audio);
        return;
      }
    }

    switch (event.type) {
      case 'session.created':
      case 'session.updated':
      case 'conversation.created':
        this.sessionReady = true;
        break;
      case 'input_audio_buffer.speech_started':
        if (this.responseInProgress) {
          this._stopLocalPlayback();
        }
        this._setState('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        break;
      case 'response.created':
        this.responseInProgress = true;
        this.micSendEnabled = false;
        this.assistantTranscript = '';
        this.audioChunksPlayed = 0;
        if (this.audioContext) this.playbackTime = this.audioContext.currentTime + PLAYBACK_LEAD_S;
        this._setState('speaking');
        break;
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (typeof event.delta === 'string') {
          this.assistantTranscript = appendTranscriptDelta(this.assistantTranscript, event.delta);
          this.callbacks.onAssistantTranscriptDelta?.(event.delta, this.assistantTranscript);
        }
        break;
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const doneText = typeof event.transcript === 'string' && event.transcript.trim()
          ? event.transcript
          : this.assistantTranscript;
        if (doneText) this.callbacks.onAssistantTranscriptDone?.(doneText);
        if (!this._textTurn) this.assistantTranscript = '';
        break;
      }
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        this._playAudioDelta(extractAudioDelta(event));
        break;
      case 'response.output_audio.done':
        this._playAudioDelta(extractAudioDelta(event));
        break;
      case 'response.done':
        this.responseInProgress = false;
        this.micSendEnabled = true;
        this.callbacks.onTurnDone?.({ audioChunks: this.audioChunksPlayed });
        this._setState(this.micActive ? 'listening' : 'connected');
        this._finishTextTurn(null);
        break;
      case 'conversation.item.input_audio_transcription.completed':
      case 'conversation.item.input_audio_transcription.updated': {
        const text = event.transcript ?? event.item?.content?.[0]?.transcript ?? '';
        if (text) this.callbacks.onUserTranscript?.(String(text).trim());
        break;
      }
      case 'error': {
        const msg = event.error?.message || event.message || 'Voice agent error';
        if (isIgnorableVoiceError(msg)) break;
        const err = new Error(msg);
        this.callbacks.onError?.(err);
        this._setState('error');
        this._finishTextTurn(err);
        break;
      }
      default:
        break;
    }
  }

  _send(payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  async startMic() {
    if (this.micActive) return;
    await this._initAudio();
    this.mediaStream = await acquireMicStream(get(micDeviceId), {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    const ctxRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.processor.onaudioprocess = (e) => {
      if (!this.connected || !this.sessionReady || !this.micSendEnabled) return;
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const channel = e.inputBuffer.getChannelData(0);
      const resampled = resample(channel, ctxRate, this.sessionSampleRate);
      if (resampled.length === 0) return;
      this._send({ type: 'input_audio_buffer.append', audio: float32ToBase64PCM16(resampled) });
    };
    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);
    this.micActive = true;
    this._setState('listening');
  }

  /** @param {Uint8Array} bytes */
  _playPcm16Bytes(bytes) {
    if (!bytes?.length) return;
    this._playFloat32(pcm16BytesToFloat32(bytes));
  }

  /** @param {string | null} base64Delta */
  _playAudioDelta(base64Delta) {
    if (!base64Delta) return;
    this._playFloat32(base64PCM16ToFloat32(base64Delta));
  }

  /** @param {Float32Array} samplesIn */
  _playFloat32(samplesIn) {
    if (!this.audioContext || !this.outputGain) return;
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    const apiRate = this.sessionSampleRate;
    const ctxRate = this.audioContext.sampleRate;
    let samples = samplesIn;
    if (!samples?.length) return;
    if (ctxRate !== apiRate) samples = resample(samples, apiRate, ctxRate);

    const buffer = this.audioContext.createBuffer(1, samples.length, ctxRate);
    buffer.copyToChannel(samples, 0);
    const src = this.audioContext.createBufferSource();
    src.buffer = buffer;
    src.connect(this.outputGain);

    const now = this.audioContext.currentTime;
    const startAt = Math.max(now, this.playbackTime);
    src.start(startAt);
    this.playbackTime = startAt + buffer.duration;
    this.scheduledSources.push(src);
    this.audioChunksPlayed += 1;
    this.callbacks.onAudioChunks?.(this.audioChunksPlayed);

    src.onended = () => {
      this.scheduledSources = this.scheduledSources.filter((s) => s !== src);
    };
  }

  async waitForPlayback() {
    if (!this.audioContext || this.audioChunksPlayed === 0) return;
    const remainingMs = Math.max(0, (this.playbackTime - this.audioContext.currentTime) * 1000 + 80);
    if (remainingMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(remainingMs, 30000)));
  }

  _stopLocalPlayback() {
    for (const src of this.scheduledSources) {
      try {
        src.stop();
      } catch (_) {}
    }
    this.scheduledSources = [];
    if (this.audioContext) this.playbackTime = this.audioContext.currentTime;
  }

  disconnect() {
    this._abort = true;
    this._finishTextTurn(new Error('Voice session ended'));
    if (this._volUnsub) {
      this._volUnsub();
      this._volUnsub = null;
    }
    if (this._sessionWaitTimer) {
      clearTimeout(this._sessionWaitTimer);
      this._sessionWaitTimer = null;
    }
    this.micActive = false;
    this.micSendEnabled = true;
    this.responseInProgress = false;
    this.sessionReady = false;
    this._stopLocalPlayback();
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (_) {}
      this.processor = null;
    }
    if (this.silentGain) {
      try {
        this.silentGain.disconnect();
      } catch (_) {}
      this.silentGain = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch (_) {}
      this.source = null;
    }
    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) t.stop();
      this.mediaStream = null;
    }
    if (this.outputGain) {
      try {
        this.outputGain.disconnect();
      } catch (_) {}
      this.outputGain = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.connected = false;
    this._setState('disconnected');
  }
}

/**
 * One typed chat turn through Eve (no mic). Used when a grok-voice model is selected.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.text
 * @param {string} [opts.voice]
 * @param {string} [opts.instructions]
 * @param {string} [opts.historyText]
 * @param {(full: string) => void} [opts.onDelta]
 * @param {AbortSignal} [opts.signal]
 */
export async function runGrokVoiceTextTurn({
  apiKey,
  text,
  voice = 'eve',
  instructions = '',
  historyText = '',
  onDelta,
  signal,
}) {
  const started = Date.now();
  let finalText = '';
  /** @type {Error | null} */
  let turnError = null;
  const session = new GrokVoiceSession({
    onAssistantTranscriptDelta: (_delta, full) => onDelta?.(full),
    onAssistantTranscriptDone: (t) => {
      if (t) finalText = t;
    },
    onError: (err) => {
      turnError = err instanceof Error ? err : new Error(String(err));
    },
  });
  const onAbort = () => session.disconnect();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal?.aborted) return { aborted: true, content: '', elapsedMs: 0, audioChunks: 0 };
    const prior = (historyText || '').trim();
    const prompt = prior
      ? `${instructions || DEFAULT_ROLEPLAY_INSTRUCTIONS}\n\nPrior conversation:\n${prior}`
      : instructions;
    await session.connect({ apiKey, instructions: prompt, voice, captureMic: false });
    if (signal?.aborted) return { aborted: true, content: '', elapsedMs: 0, audioChunks: 0 };
    const spoken = await session.sendText(text);
    if (turnError) throw turnError;
    await session.waitForPlayback();
    return {
      aborted: false,
      content: (spoken || finalText || '').trim(),
      elapsedMs: Date.now() - started,
      audioChunks: session.audioChunksPlayed,
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    session.disconnect();
  }
}

/** Benign xAI errors we should not show in the UI (VAD handles these server-side). */
export function isIgnorableVoiceError(message) {
  const m = String(message || '').toLowerCase();
  return m.includes('cancellation failed') || m.includes('no active response');
}
