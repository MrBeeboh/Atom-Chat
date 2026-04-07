/**
 * @file streamReporter.js
 * @description Single interception point for streamChatCompletion. Updates themeMetrics (Lab overlay)
 * with throttled live metrics. Does not modify api.js. Single writer to themeMetrics.
 */
import { streamChatCompletion } from '$lib/api.js';
import { themeMetrics } from '$lib/stores.js';

const THROTTLE_MS = 100;

/**
 * Wraps streamChatCompletion: records start, counts chunks, throttles themeMetrics updates,
 * records latency and total tokens on completion, resets on error.
 * Start and end events are written immediately; during stream, updates at most every THROTTLE_MS.
 * @param {Parameters<typeof streamChatCompletion>[0]} args - Same as streamChatCompletion
 * @returns {Promise<{ usage?: object, elapsedMs: number, aborted?: boolean }>}
 */
export async function streamChatCompletionWithMetrics(args) {
  const start = performance.now();
  const temperature = args.options?.temperature ?? null;

  themeMetrics.set({
    isStreaming: true,
    liveChunks: 0,
    liveChunksPerSec: 0,
    lastLatencyMs: null,
    lastTokenAt: null,
    lastTotalTokens: null,
    temperature: temperature != null ? Number(temperature) : null,
  });

  let chunkCount = 0;
  let lastUpdateAt = 0;

  const wrappedOnChunk = (chunk) => {
    chunkCount += 1;
    const now = performance.now();
    const elapsedSec = (now - start) / 1000;
    const chunksPerSec = elapsedSec > 0 ? chunkCount / elapsedSec : 0;

    if (now - lastUpdateAt >= THROTTLE_MS) {
      lastUpdateAt = now;
      themeMetrics.update((m) => ({
        ...m,
        liveChunks: chunkCount,
        liveChunksPerSec: chunksPerSec,
        lastTokenAt: now,
      }));
    }
    args.onChunk?.(chunk);
  };

  const wrappedOnDone = () => {
    args.onDone?.();
  };

  try {
    const result = await streamChatCompletion({
      ...args,
      onChunk: wrappedOnChunk,
      onDone: wrappedOnDone,
    });

    const latencyMs = performance.now() - start;
    const totalTokens = result?.usage?.completion_tokens ?? null;

    themeMetrics.update((m) => ({
      ...m,
      isStreaming: false,
      liveChunks: chunkCount,
      lastLatencyMs: latencyMs,
      lastTotalTokens: totalTokens,
    }));

    return result;
  } catch (err) {
    themeMetrics.update((m) => ({ ...m, isStreaming: false }));
    throw err;
  }
}
