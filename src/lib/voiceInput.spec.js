import { describe, expect, it, vi } from 'vitest';
import { resolveVoiceServerUrl, checkVoiceServerHealth, transcribeBlob, estimateDataUrlMb } from './voiceInput.js';

describe('resolveVoiceServerUrl', () => {
  it('prefers the store value and strips a trailing slash', () => {
    expect(resolveVoiceServerUrl('http://localhost:9000/')).toBe('http://localhost:9000');
    expect(resolveVoiceServerUrl('http://localhost:9000')).toBe('http://localhost:9000');
  });

  it('falls back to the default when the store value is null', () => {
    expect(resolveVoiceServerUrl(null)).toBe('http://localhost:8765');
  });

  it('returns empty when the store value is an empty string', () => {
    expect(resolveVoiceServerUrl('')).toBe('');
  });
});

describe('checkVoiceServerHealth', () => {
  it('GETs /health with a signal and returns the response', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mock);
    const res = await checkVoiceServerHealth('http://localhost:8765');
    expect(res.ok).toBe(true);
    expect(mock).toHaveBeenCalledWith('http://localhost:8765/health', expect.objectContaining({ signal: expect.anything() }));
    vi.unstubAllGlobals();
  });
});

describe('transcribeBlob', () => {
  it('posts the blob and returns trimmed text', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: '  hello  ' }) });
    vi.stubGlobal('fetch', mock);
    const text = await transcribeBlob(new Blob(['x']), 'http://localhost:8765');
    expect(text).toBe('hello');
    expect(mock).toHaveBeenCalledWith(
      'http://localhost:8765/transcribe',
      expect.objectContaining({ method: 'POST', signal: expect.anything() }),
    );
    vi.unstubAllGlobals();
  });

  it('throws with the server body when the response is not ok', async () => {
    const mock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', mock);
    await expect(transcribeBlob(new Blob(['x']), 'http://localhost:8765')).rejects.toThrow('boom');
    vi.unstubAllGlobals();
  });
});

describe('estimateDataUrlMb', () => {
  it('approximates base64 bytes from string length', () => {
    // 4 chars -> 3 bytes -> 3 / 1048576 MB
    expect(estimateDataUrlMb('abcd')).toBeCloseTo(3 / 1024 / 1024, 10);
    expect(estimateDataUrlMb('')).toBe(0);
  });
});
