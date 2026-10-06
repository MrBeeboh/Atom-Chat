import { describe, expect, it } from 'vitest';
import { bytesToBase64, lastTps } from './arenaView.js';

describe('bytesToBase64', () => {
  it('encodes bytes to base64', () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk='); // "hi"
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });
});

describe('lastTps', () => {
  it('prefers server-reported tok_per_sec', () => {
    expect(lastTps([{ role: 'assistant', stats: { tok_per_sec: 42.37 } }])).toBe('42.4');
  });

  it('falls back to completion tokens over elapsed seconds', () => {
    expect(lastTps([{ role: 'assistant', stats: { completion_tokens: 100, elapsed_ms: 2000 } }])).toBe('50.0');
  });

  it('returns null when no assistant message has stats', () => {
    expect(lastTps([{ role: 'user' }])).toBeNull();
    expect(lastTps([])).toBeNull();
  });
});
