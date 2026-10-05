import { describe, expect, it } from 'vitest';
import { throwIfAborted, waitUntilLoaded } from './modelLoadUnload.js';

describe('throwIfAborted', () => {
  it('throws AbortError when the signal is already aborted', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    try {
      throwIfAborted(ctrl.signal);
      throw new Error('expected AbortError');
    } catch (e) {
      expect(e.name).toBe('AbortError');
    }
  });

  it('is a no-op when the signal is live or missing', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
  });
});

describe('waitUntilLoaded', () => {
  it('throws AbortError immediately when Stop already aborted the load', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(waitUntilLoaded('Qwen3.8-9B', { signal: ctrl.signal, timeoutMs: 5000 })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
