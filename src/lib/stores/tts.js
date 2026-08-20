/**
 * @file tts.js
 * @description Read-aloud TTS prefs + Eve conflict guard.
 */
import { writable } from 'svelte/store';
import { readBool, readNum } from './_utils.js';

function loadVoiceUri() {
  if (typeof localStorage === 'undefined') return '';
  return (localStorage.getItem('ttsVoiceUri') ?? '').trim();
}

function loadTtsEngine() {
  if (typeof localStorage === 'undefined') return 'kokoro';
  const v = (localStorage.getItem('ttsEngine') ?? '').trim();
  if (v === 'browser' || v === 'kokoro') return v;
  return 'kokoro';
}

function loadKokoroVoice() {
  if (typeof localStorage === 'undefined') return 'af_bella';
  return (localStorage.getItem('ttsKokoroVoice') ?? 'af_bella').trim() || 'af_bella';
}

/** One-time: switch existing installs from robotic browser TTS to Kokoro defaults. */
function migrateTtsToKokoroDefaults() {
  if (typeof localStorage === 'undefined') return;
  if (localStorage.getItem('ttsKokoroDefaultsV1') === '1') return;
  localStorage.setItem('ttsEngine', 'kokoro');
  localStorage.setItem('ttsKokoroVoice', 'af_bella');
  localStorage.setItem('ttsRate', '1');
  localStorage.setItem('ttsKokoroDefaultsV1', '1');
}
migrateTtsToKokoroDefaults();

/** User toggled read-aloud on in the chat bar speaker icon. */
export const ttsReadAloudEnabled = writable(readBool('ttsReadAloudEnabled', false));
if (typeof localStorage !== 'undefined') {
  ttsReadAloudEnabled.subscribe((v) => {
    localStorage.setItem('ttsReadAloudEnabled', v ? '1' : '0');
  });
}

/** `kokoro` = DeepInfra Kokoro-82M (natural). `browser` = OS speechSynthesis (robotic fallback). */
export const ttsEngine = writable(loadTtsEngine());
if (typeof localStorage !== 'undefined') {
  ttsEngine.subscribe((v) => {
    localStorage.setItem('ttsEngine', v === 'browser' ? 'browser' : 'kokoro');
  });
}

/** True while xAI Eve voice roleplay session is active — read-aloud stays disabled. */
export const voiceRoleplaySessionActive = writable(false);

/** Message id currently being read aloud, or null. */
export const ttsActiveMessageId = writable(/** @type {string | null} */ (null));

/** True while waiting for Kokoro to synthesize (before audio plays). */
export const ttsPreparing = writable(false);

/** Browser speechSynthesis voice URI (browser engine only). */
export const ttsVoiceUri = writable(loadVoiceUri());
if (typeof localStorage !== 'undefined') {
  ttsVoiceUri.subscribe((v) => {
    localStorage.setItem('ttsVoiceUri', typeof v === 'string' ? v.trim() : '');
  });
}

/** Kokoro preset voice id (kokoro engine). */
export const ttsKokoroVoice = writable(loadKokoroVoice());
if (typeof localStorage !== 'undefined') {
  ttsKokoroVoice.subscribe((v) => {
    localStorage.setItem('ttsKokoroVoice', typeof v === 'string' ? v.trim() || 'af_bella' : 'af_bella');
  });
}

export const ttsRate = writable(readNum('ttsRate', 1));
if (typeof localStorage !== 'undefined') {
  ttsRate.subscribe((v) => {
    const n = Number(v);
    localStorage.setItem('ttsRate', String(Number.isFinite(n) ? n : 1));
  });
}
