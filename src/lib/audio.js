let ctx = null;
let masterGain = null;
const lastPlayed = new Map();

function ensureContext() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') {
    try { ctx.resume(); } catch (_) {}
  }
  return ctx;
}

export function primeAudio() {
  ensureContext();
}

function canPlay(key, minMs) {
  const now = Date.now();
  const last = lastPlayed.get(key) || 0;
  if (now - last < minMs) return false;
  lastPlayed.set(key, now);
  return true;
}

function playTone({ freq = 880, duration = 0.05, type = 'sine', volume = 0.2, minInterval = 40 } = {}) {
  const c = ensureContext();
  if (!c) return;
  if (!canPlay(`${type}:${freq}`, minInterval)) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = c.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(masterGain || c.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function playClick(vol = 0.25) {
  playTone({ freq: 1200, duration: 0.03, type: 'sine', volume: vol * 0.35, minInterval: 30 });
}

export function playComplete(vol = 0.25) {
  playTone({ freq: 880, duration: 0.08, type: 'triangle', volume: vol * 0.65, minInterval: 120 });
}
