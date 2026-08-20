/**
 * Open-mic helpers: silence-based utterance cuts + junk transcript filter.
 * Uses the same Whisper voice server as click-to-dictate.
 */

export const OPEN_MIC = {
  silenceAfterSpeechMs: 1100,
  minSpeechMs: 400,
  maxUtteranceMs: 45000,
  maxWaitForSpeechMs: 20000,
  pollMs: 50,
};

const JUNK = /^(thanks for watching\.?|thank you\.?|thanks\.?|you\.?|bye\.?|goodbye\.?|\.|…|\.{2,}|uh+|um+|hmm+|mm+|ah+)$/i;

export function isUsefulTranscript(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < 2) return false;
  if (JUNK.test(t)) return false;
  return true;
}

export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

/**
 * RMS meter on a live MediaStream.
 * @param {MediaStream} stream
 * @returns {{ rms: () => number, close: () => void }}
 */
export function createLevelMeter(stream) {
  const Ctx = typeof AudioContext !== 'undefined' ? AudioContext : globalThis.webkitAudioContext;
  if (!Ctx) return { rms: () => 0, close: () => {} };
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.4;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    rms() {
      if (ctx.state === 'suspended') ctx.resume?.();
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    },
    close() {
      try {
        source.disconnect();
      } catch {
        /* ignore */
      }
      ctx.close?.().catch(() => {});
    },
  };
}

/**
 * Record one utterance: wait for speech, then cut after silence.
 * Does not stop the MediaStream tracks (open mic keeps the mic).
 * @param {MediaStream} stream
 * @param {{ cancelled?: () => boolean }} [opts]
 * @returns {Promise<Blob | null>}
 */
export function recordUntilSilence(stream, opts = {}) {
  const cancelled = opts.cancelled || (() => false);
  const mime = pickRecorderMime();
  return new Promise((resolve) => {
    let rec;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      resolve(null);
      return;
    }
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const meter = createLevelMeter(stream);
    let noiseFloor = 0.006;
    let samples = 0;
    let heardSpeech = false;
    let speechStartedAt = 0;
    let lastLoudAt = 0;
    const started = Date.now();
    let settled = false;

    function blobFromChunks() {
      return chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null;
    }

    function settle(blob) {
      if (settled) return;
      settled = true;
      clearInterval(pollId);
      meter.close();
      resolve(blob);
    }

    function requestStop() {
      if (rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          settle(blobFromChunks());
        }
      } else {
        settle(blobFromChunks());
      }
    }

    rec.onstop = () => settle(heardSpeech ? blobFromChunks() : null);

    const pollId = setInterval(() => {
      if (cancelled()) {
        requestStop();
        return;
      }
      const level = meter.rms();
      const now = Date.now();
      samples += 1;
      if (!heardSpeech && samples < 12) {
        noiseFloor = noiseFloor * 0.85 + level * 0.15;
      }
      const threshold = Math.max(0.012, noiseFloor * 3.2);
      if (level >= threshold) {
        if (!heardSpeech) {
          heardSpeech = true;
          speechStartedAt = now;
        }
        lastLoudAt = now;
      }
      if (
        heardSpeech &&
        now - lastLoudAt >= OPEN_MIC.silenceAfterSpeechMs &&
        now - speechStartedAt >= OPEN_MIC.minSpeechMs
      ) {
        requestStop();
        return;
      }
      if (now - started >= OPEN_MIC.maxUtteranceMs) {
        requestStop();
        return;
      }
      if (!heardSpeech && now - started >= OPEN_MIC.maxWaitForSpeechMs) requestStop();
    }, OPEN_MIC.pollMs);

    try {
      rec.start(250);
    } catch {
      requestStop();
    }
  });
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * After a sent utterance: wait for the model stream, then TTS start+finish,
 * then a short gap so the mic does not reopen into the tail of playback.
 * @param {{
 *   cancelled?: () => boolean,
 *   isStreaming?: () => boolean,
 *   isTtsBusy?: () => boolean,
 *   sleep?: (ms: number) => Promise<void>,
 *   maxMs?: number,
 *   ttsStartGraceMs?: number,
 *   afterTtsMs?: number,
 * }} [opts]
 */
export async function waitUntilReplySpoken(opts = {}) {
  const cancelled = opts.cancelled || (() => false);
  const isStreaming = opts.isStreaming || (() => false);
  const isTtsBusy = opts.isTtsBusy || (() => false);
  const sleepFn = opts.sleep || sleep;
  const maxMs = opts.maxMs ?? 120000;
  const ttsStartGraceMs = opts.ttsStartGraceMs ?? 1800;
  const afterTtsMs = opts.afterTtsMs ?? 400;
  const start = Date.now();

  while (!cancelled()) {
    if (!isStreaming()) break;
    if (Date.now() - start > maxMs) return;
    await sleepFn(100);
  }
  if (cancelled()) return;

  const graceEnd = Date.now() + ttsStartGraceMs;
  let sawTts = isTtsBusy();
  while (!cancelled() && !sawTts && Date.now() < graceEnd) {
    await sleepFn(80);
    sawTts = isTtsBusy();
  }
  if (cancelled()) return;
  if (!sawTts) {
    await sleepFn(afterTtsMs);
    return;
  }
  while (!cancelled()) {
    if (!isTtsBusy()) {
      await sleepFn(afterTtsMs);
      return;
    }
    if (Date.now() - start > maxMs) return;
    await sleepFn(120);
  }
}
