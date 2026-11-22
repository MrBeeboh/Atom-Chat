import { afterEach, describe, expect, it, vi } from 'vitest';
import { freeVramForLoad, throwIfAborted, waitUntilLoaded } from './modelLoadUnload.js';
import { apiState } from './apiState.js';

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

/**
 * Fake :8080 router + :8081 Flash-Next sidecar.
 * @param {{ loaded?: string[], flashUp?: boolean, flashStopsOnUnload?: boolean }} opts
 */
function fakeBackend({ loaded = [], flashUp = false, flashStopsOnUnload = true } = {}) {
  const state = { loaded: new Set(loaded), flashUp, unloads: [] };
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const fetchMock = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.includes(':8081/health')) {
      return state.flashUp ? new Response('ok', { status: 200 }) : new Response('down', { status: 503 });
    }
    if (u.endsWith('/models/unload')) {
      const { model } = JSON.parse(init.body);
      state.unloads.push(model);
      state.loaded.delete(model);
      if (model === 'Qwen3.8-Flash-Next' && flashStopsOnUnload) state.flashUp = false;
      return json({ success: true });
    }
    if (u.endsWith('/models')) {
      const ids = ['QWEN3-CODER-NEXT-Q4_K_M', 'gemma-3-12b-it-Q4_K_M', 'Qwen3.5-9B-Q4_K_M', 'Qwen3.8-Flash-Next'];
      return json({
        data: ids.map((id) => ({ id, status: { value: state.loaded.has(id) ? 'loaded' : 'unloaded' } })),
      });
    }
    return new Response('not found', { status: 404 });
  });
  return { state, fetchMock };
}

describe('freeVramForLoad', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    apiState.llamaRouterModelsSupported = null;
  });

  it('stops Flash-Next before a router model loads (it holds both GPUs)', async () => {
    const { state, fetchMock } = fakeBackend({ flashUp: true });
    vi.stubGlobal('fetch', fetchMock);
    await freeVramForLoad('QWEN3-CODER-NEXT-Q4_K_M');
    expect(state.unloads).toContain('Qwen3.8-Flash-Next');
    expect(state.flashUp).toBe(false);
  });

  it('fails fast with a fix when Flash-Next will not stop', async () => {
    const { fetchMock } = fakeBackend({ flashUp: true, flashStopsOnUnload: false });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      freeVramForLoad('QWEN3-CODER-NEXT-Q4_K_M', { flashStopTimeoutMs: 50 }),
    ).rejects.toThrow(/llama-flash-next stop/);
  });

  it('unloads router models before Flash-Next starts', async () => {
    const { state, fetchMock } = fakeBackend({ loaded: ['QWEN3-CODER-NEXT-Q4_K_M'] });
    vi.stubGlobal('fetch', fetchMock);
    await freeVramForLoad('Qwen3.8-Flash-Next');
    expect(state.unloads).toEqual(['QWEN3-CODER-NEXT-Q4_K_M']);
  });

  it('keeps residents and drops everything else', async () => {
    const { state, fetchMock } = fakeBackend({ loaded: ['gemma-3-12b-it-Q4_K_M', 'QWEN3-CODER-NEXT-Q4_K_M'] });
    vi.stubGlobal('fetch', fetchMock);
    await freeVramForLoad('Qwen3.5-9B-Q4_K_M', { keep: ['gemma-3-12b-it-Q4_K_M'] });
    expect(state.unloads).toEqual(['QWEN3-CODER-NEXT-Q4_K_M']);
    expect(state.loaded.has('gemma-3-12b-it-Q4_K_M')).toBe(true);
  });

  it('is a no-op for cloud models', async () => {
    const { fetchMock } = fakeBackend({ flashUp: true });
    vi.stubGlobal('fetch', fetchMock);
    await freeVramForLoad('deepseek:deepseek-chat');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
