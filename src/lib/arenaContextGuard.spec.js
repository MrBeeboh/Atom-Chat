import { describe, it, expect, vi } from 'vitest';
import {
  ARENA_CONTEXT_WIPE_THRESHOLD,
  buildEraseRequest,
  buildResetRequest,
  buildSlotsUrl,
  contextUsageRatio,
  createArenaContextGuard,
  ctxSizeFromModelsPayload,
  decideWipe,
  estimatePromptTokens,
  formatWipeNote,
  isGuardableLocalModel,
  parseSlots,
  usageTokens,
} from './arenaContextGuard.js';

const M = 'Qwen3.8-27B-Q4_K_M';
const BASE = '/api/llama';
const N_CTX = 32768;

function jsonRes(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}
function slotRow(fill, { processing = false, nCtx = N_CTX, id = 0 } = {}) {
  return { id, n_ctx: nCtx, is_processing: processing, n_prompt_tokens: fill, next_token: [{ n_decoded: 0 }] };
}

/** Fake llama router: GET /slots, POST erase (501 unless eraseOk), POST /completion reset. */
function fakeServer({ fill = 0, eraseOk = false, slotsStatus = 200, processing = false, failAll = false } = {}) {
  const state = { fill, calls: [] };
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    state.calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (failAll) throw new Error('ECONNREFUSED');
    if (method === 'GET' && url.includes('/slots?')) {
      if (slotsStatus !== 200) return jsonRes(slotsStatus, { error: { message: 'model is not loaded' } });
      return jsonRes(200, [slotRow(state.fill, { processing })]);
    }
    if (method === 'POST' && url.includes('action=erase')) {
      if (!eraseOk) return jsonRes(501, { error: { code: 501, type: 'not_supported_error' } });
      state.fill = 0;
      return jsonRes(200, { id_slot: 0, n_erased: 1 });
    }
    if (method === 'POST' && url.includes('/completion')) {
      state.fill = 1;
      return jsonRes(200, { content: ' ', tokens_predicted: 1 });
    }
    if (method === 'GET' && url.endsWith('/models')) {
      return jsonRes(200, { data: [{ id: M, status: { value: 'loaded', args: ['--ctx-size', String(N_CTX)] } }] });
    }
    return jsonRes(404, {});
  });
  return { state, fetchImpl };
}
function makeGuard(server, extra = {}) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const onNote = vi.fn();
  const guard = createArenaContextGuard({ getBase: () => BASE, fetchImpl: server.fetchImpl, logger, onNote, ...extra });
  return { guard, logger, onNote };
}
const usageFor = (total) => ({ prompt_tokens: Math.floor(total / 2), completion_tokens: total - Math.floor(total / 2) });

describe('arenaContextGuard math', () => {
  it('threshold constant defaults to 0.75', () => {
    expect(ARENA_CONTEXT_WIPE_THRESHOLD).toBe(0.75);
  });
  it('ratio = (prompt + completion) / n_ctx', () => {
    expect(contextUsageRatio(16000, 8576, 32768)).toBeCloseTo(0.75, 10);
    expect(contextUsageRatio(100, 0, 1000)).toBe(0.1);
    expect(contextUsageRatio(100, 50, 0)).toBeNull();
    expect(contextUsageRatio(100, 50, undefined)).toBeNull();
  });
  it('skips at 74.9%', () => {
    expect(decideWipe({ fill: 749, nCtx: 1000 })).toMatchObject({ wipe: false, why: 'below-threshold' });
  });
  it('triggers at exactly 75% and above', () => {
    expect(decideWipe({ fill: 750, nCtx: 1000 })).toMatchObject({ wipe: true, ratio: 0.75 });
    expect(decideWipe({ fill: 24576, nCtx: 32768 }).wipe).toBe(true);
    expect(decideWipe({ fill: 990, nCtx: 1000 }).wipe).toBe(true);
  });
  it('skips when n_ctx is unknown', () => {
    expect(decideWipe({ fill: 5000, nCtx: 0 })).toMatchObject({ wipe: false, why: 'unknown-n_ctx' });
  });
  it('pre-flight projection never wipes a near-empty slot', () => {
    expect(decideWipe({ fill: 10, nCtx: 1000, extraTokens: 900 })).toMatchObject({ wipe: false, why: 'near-empty' });
    expect(decideWipe({ fill: 200, nCtx: 1000, extraTokens: 600 })).toMatchObject({ wipe: true });
    expect(decideWipe({ fill: 200, nCtx: 1000, extraTokens: 500 })).toMatchObject({ wipe: false });
  });
  it('usage tokens from usage, else llama timings', () => {
    expect(usageTokens({ prompt_tokens: 24, completion_tokens: 51 })).toEqual({ prompt: 24, completion: 51, total: 75 });
    expect(usageTokens(null, { prompt_n: 10, cache_n: 90, predicted_n: 50 })).toEqual({ prompt: 100, completion: 50, total: 150 });
    expect(usageTokens(null, null)).toBeNull();
  });
  it('estimates prompt tokens from text and images', () => {
    expect(estimatePromptTokens([{ role: 'user', content: 'x'.repeat(400) }])).toBe(100);
    expect(estimatePromptTokens([{ role: 'user', content: [{ type: 'text', text: 'abcd' }, { type: 'image_url' }] }])).toBe(1 + 1024);
  });
  it('local vs cloud model ids', () => {
    expect(isGuardableLocalModel(M)).toBe(true);
    expect(isGuardableLocalModel('deepseek:deepseek-chat')).toBe(false);
    expect(isGuardableLocalModel('')).toBe(false);
    expect(isGuardableLocalModel(null)).toBe(false);
  });
});

describe('arenaContextGuard requests', () => {
  it('builds the erase request (router routes POST by body.model, never autoloads)', () => {
    const { url, init } = buildEraseRequest(BASE, M, 0);
    expect(url).toBe('/api/llama/slots/0?action=erase&autoload=false');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ model: M });
  });
  it('builds the fallback reset request pinned to the slot with cache_prompt off', () => {
    const { url, init } = buildResetRequest('http://localhost:8080/', M, 2);
    expect(url).toBe('http://localhost:8080/completion?autoload=false');
    expect(JSON.parse(init.body)).toEqual({ model: M, prompt: '.', n_predict: 1, cache_prompt: false, id_slot: 2, stream: false });
  });
  it('builds the /slots url with model + autoload=false; Flash-Next uses its sidecar', () => {
    expect(buildSlotsUrl(BASE, M)).toBe(`/api/llama/slots?model=${encodeURIComponent(M)}&autoload=false`);
    expect(buildSlotsUrl(BASE, 'Qwen3.8-Flash-Next')).toMatch(/^http:\/\/127\.0\.0\.1:8081\/slots\?/);
  });
  it('parses /slots and /models n_ctx', () => {
    expect(parseSlots([slotRow(74)])).toEqual([{ id: 0, nCtx: N_CTX, fill: 74, processing: false }]);
    expect(parseSlots({ error: 1 })).toBeNull();
    expect(ctxSizeFromModelsPayload({ data: [{ id: M, status: { args: ['--ctx-size', '32768'] } }] }, M)).toBe(32768);
    expect(ctxSizeFromModelsPayload({ data: [{ id: 'other', status: { args: ['-c', '8192'] } }] }, M)).toBe(0);
  });
  it('formats a short note with the percentage and reason', () => {
    expect(formatWipeNote({ modelId: M, ratio: 0.8123, reason: 'after answer' })).toBe(`KV cache reset: ${M} at 81.2% (after answer)`);
  });
});

describe('arenaContextGuard afterAnswer', () => {
  it('skips cloud/API models without any network call', async () => {
    const server = fakeServer({ fill: 30000 });
    const { guard } = makeGuard(server);
    const r = await guard.afterAnswer('deepseek:deepseek-chat', { usage: usageFor(30000) });
    expect(r).toMatchObject({ wiped: false, skipped: 'cloud' });
    expect(server.fetchImpl).not.toHaveBeenCalled();
  });

  it('skips at 74.9% of the slot n_ctx', async () => {
    const fill = Math.floor(N_CTX * 0.749);
    const server = fakeServer({ fill });
    const { guard, onNote } = makeGuard(server);
    const r = await guard.afterAnswer(M, { usage: usageFor(fill) });
    expect(r.wiped).toBe(false);
    expect(onNote).not.toHaveBeenCalled();
    expect(server.state.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    // n_ctx now cached → next small answer needs no network at all
    server.fetchImpl.mockClear();
    await guard.afterAnswer(M, { usage: usageFor(500) });
    expect(server.fetchImpl).not.toHaveBeenCalled();
  });

  it('wipes at exactly 75%: tries erase, falls back to reset on 501, notes it', async () => {
    const fill = N_CTX * 0.75;
    const server = fakeServer({ fill });
    const { guard, onNote, logger } = makeGuard(server);
    const r = await guard.afterAnswer(M, { usage: usageFor(fill) });
    expect(r.wiped).toBe(true);
    expect(r.results[0]).toMatchObject({ slot: 0, method: 'reset', ratio: 0.75 });
    const posts = server.state.calls.filter((c) => c.method === 'POST').map((c) => c.url);
    expect(posts).toEqual(['/api/llama/slots/0?action=erase&autoload=false', '/api/llama/completion?autoload=false']);
    expect(server.state.fill).toBe(1);
    expect(onNote).toHaveBeenCalledWith(`KV cache reset: ${M} at 75% (after answer)`);
    expect(logger.info).toHaveBeenCalled();
    // erase remembered as unsupported → next wipe goes straight to reset
    server.state.fill = 30000;
    server.state.calls.length = 0;
    await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(server.state.calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/llama/completion?autoload=false']);
  });

  it('uses the built-in erase when the server supports it', async () => {
    const server = fakeServer({ fill: 30000, eraseOk: true });
    const { guard } = makeGuard(server);
    const r = await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(r.results[0].method).toBe('erase');
    expect(server.state.calls.some((c) => c.url.includes('/completion'))).toBe(false);
  });

  it('decides on what the slot actually holds, not stale usage', async () => {
    const server = fakeServer({ fill: 200 }); // slot already small (e.g. another request since)
    const { guard } = makeGuard(server);
    const r = await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(r).toMatchObject({ wiped: false, skipped: 'not-needed' });
    expect(server.state.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('skips when the model is not loaded (never autoloads)', async () => {
    const server = fakeServer({ fill: 30000, slotsStatus: 400 });
    const { guard } = makeGuard(server);
    const r = await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(r).toMatchObject({ wiped: false, skipped: 'not-loaded' });
    expect(server.state.calls.every((c) => c.url.includes('autoload=false'))).toBe(true);
  });

  it('skips when n_ctx cannot be found anywhere', async () => {
    const fetchImpl = vi.fn(async () => jsonRes(500, null));
    const { guard } = makeGuard({ fetchImpl });
    const r = await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(r).toMatchObject({ wiped: false, skipped: 'unknown-n_ctx' });
  });

  it('falls back to /models --ctx-size and usage when /slots is unavailable', async () => {
    const server = fakeServer({ fill: 30000, slotsStatus: 501 });
    const { guard } = makeGuard(server);
    const r = await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(r.wiped).toBe(true);
    expect(server.state.calls.some((c) => c.url.endsWith('/models'))).toBe(true);
  });

  it('an erase/network failure never throws and warns', async () => {
    const server = fakeServer({ failAll: true });
    const { guard, logger } = makeGuard(server);
    guard._state.nCtxCache.set(M, N_CTX);
    await expect(guard.afterAnswer(M, { usage: usageFor(30000) })).resolves.toMatchObject({ wiped: false });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('a hung server is cut off by the short timeout', async () => {
    const fetchImpl = vi.fn((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const { guard } = makeGuard({ fetchImpl }, { timeoutMs: 20 });
    guard._state.nCtxCache.set(M, N_CTX);
    const t0 = Date.now();
    const r = await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(r.wiped).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a throwing onNote/logger cannot break the run', async () => {
    const server = fakeServer({ fill: 30000 });
    const guard = createArenaContextGuard({
      getBase: () => BASE,
      fetchImpl: server.fetchImpl,
      logger: { info: () => { throw new Error('x'); }, warn: () => { throw new Error('y'); } },
      onNote: () => { throw new Error('z'); },
    });
    await expect(guard.afterAnswer(M, { usage: usageFor(30000) })).resolves.toMatchObject({ wiped: true });
  });
});

describe('arenaContextGuard shared-model safety', () => {
  it('defers while another Arena request for the same model is in flight, then wipes on end', async () => {
    const server = fakeServer({ fill: 30000 });
    const { guard } = makeGuard(server);
    guard.beginRequest(M); // panel B still streaming the same model
    const r = await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(r).toMatchObject({ wiped: false, skipped: 'deferred' });
    expect(server.state.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    guard.endRequest(M);
    await vi.waitFor(() => expect(server.state.fill).toBe(1));
  });

  it('defers when the server reports the slot is processing (e.g. judge on the same model)', async () => {
    const server = fakeServer({ fill: 30000, processing: true });
    const { guard } = makeGuard(server);
    const r = await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(r.skipped).toBe('deferred');
    expect(guard._state.pending.has(M)).toBe(true);
  });

  it('dedupes concurrent wipes for one model', async () => {
    const server = fakeServer({ fill: 30000 });
    const { guard } = makeGuard(server);
    const [a, b] = await Promise.all([
      guard.afterAnswer(M, { usage: usageFor(30000) }),
      guard.afterAnswer(M, { usage: usageFor(30000) }),
    ]);
    expect(a).toBe(b);
    expect(server.state.calls.filter((c) => c.url.includes('/completion'))).toHaveLength(1);
  });

  it('ignores cloud ids in in-flight tracking', () => {
    const { guard } = makeGuard(fakeServer());
    guard.beginRequest('xai:grok-4');
    expect(guard._state.inFlight.size).toBe(0);
  });
});

describe('arenaContextGuard beforeQuestion (pre-flight)', () => {
  const q = [{ role: 'user', content: 'x'.repeat(4000) }]; // ≈1000 tokens

  it('no history → no network', async () => {
    const server = fakeServer({ fill: 30000 });
    const { guard } = makeGuard(server);
    expect(await guard.beforeQuestion(M, { messages: q, maxTokens: 4096 })).toMatchObject({ skipped: 'no-history' });
    expect(server.fetchImpl).not.toHaveBeenCalled();
  });

  it('wipes first when cached usage + prompt + max_tokens reaches the threshold', async () => {
    const server = fakeServer({ fill: 20000 });
    const { guard, onNote } = makeGuard(server);
    await guard.afterAnswer(M, { usage: usageFor(20000) }); // 61% → kept
    expect(server.state.fill).toBe(20000);
    const r = await guard.beforeQuestion(M, { messages: q, maxTokens: 4096 }); // 20000+1000+4096 ≥ 24576
    expect(r.wiped).toBe(true);
    expect(onNote).toHaveBeenLastCalledWith(expect.stringContaining('(pre-flight)'));
  });

  it('skips when the projection stays below the threshold (no network)', async () => {
    const server = fakeServer({ fill: 10000 });
    const { guard } = makeGuard(server);
    await guard.afterAnswer(M, { usage: usageFor(10000) });
    server.fetchImpl.mockClear();
    expect(await guard.beforeQuestion(M, { messages: q, maxTokens: 4096 })).toMatchObject({ skipped: 'below-threshold' });
    expect(server.fetchImpl).not.toHaveBeenCalled();
  });

  it('never wipes a near-empty slot even with a huge max_tokens', async () => {
    const server = fakeServer({ fill: 300 });
    const { guard } = makeGuard(server);
    await guard.afterAnswer(M, { usage: usageFor(300) });
    const r = await guard.beforeQuestion(M, { messages: q, maxTokens: 30000 });
    expect(r.wiped).toBe(false);
    expect(server.state.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('skips while a request for the model is in flight, and for cloud models', async () => {
    const server = fakeServer({ fill: 30000 });
    const { guard } = makeGuard(server);
    guard.beginRequest(M);
    expect(await guard.beforeQuestion(M, { messages: q })).toMatchObject({ skipped: 'in-flight' });
    expect(await guard.beforeQuestion('deepseek:x', { messages: q })).toMatchObject({ skipped: 'cloud' });
  });

  it('runs a deferred wipe before the next question', async () => {
    const server = fakeServer({ fill: 30000, processing: true });
    const { guard } = makeGuard(server);
    await guard.afterAnswer(M, { usage: usageFor(30000) });
    expect(guard._state.pending.has(M)).toBe(true);
    // judge/other request finished; the slot is idle now
    server.fetchImpl.mockImplementation(fakeServer({ fill: 30000 }).fetchImpl);
    const r = await guard.beforeQuestion(M, { messages: q, maxTokens: 4096 });
    expect(r.wiped).toBe(true);
    expect(guard._state.pending.has(M)).toBe(false);
  });
});
