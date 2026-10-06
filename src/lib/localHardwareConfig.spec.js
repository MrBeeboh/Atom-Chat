import { describe, expect, it } from 'vitest';
import {
  LOCAL_CONTEXT_UI_MAX,
  LOCAL_LLAMA_CTX_SIZE,
  LOCAL_MAX_TOKENS_UI_MAX,
  isStaleAtomContextCap,
  migrateLocalContextSettings,
  resolveLocalContextLength,
  resolveLocalMaxTokens,
} from './localHardwareConfig.js';

describe('localHardwareConfig', () => {
  it('asks llama.cpp for the GGUF training context, not a 32k or 256k ATOM cap', () => {
    expect(LOCAL_LLAMA_CTX_SIZE).toBe(0);
    expect(LOCAL_CONTEXT_UI_MAX).toBeGreaterThan(32768);
  });

  it('uses the model trained max when we know it, even if that is 32k', () => {
    expect(resolveLocalContextLength(32768, 32768)).toBe(32768);
    expect(resolveLocalContextLength(32768, 131072)).toBe(131072);
    expect(resolveLocalContextLength(undefined, 262144)).toBe(262144);
    expect(resolveLocalContextLength(4096, 4096)).toBe(4096);
  });

  it('treats missing or stale ATOM caps as native (0) when the model max is unknown', () => {
    expect(resolveLocalContextLength(undefined)).toBe(0);
    expect(resolveLocalContextLength(4096)).toBe(0);
    expect(resolveLocalContextLength(8192)).toBe(0);
    expect(resolveLocalContextLength(16384)).toBe(0);
    expect(resolveLocalContextLength(32768)).toBe(0);
    expect(resolveLocalContextLength(0)).toBe(0);
  });

  it('keeps an explicit context the user set above the old caps', () => {
    expect(resolveLocalContextLength(65536)).toBe(65536);
    expect(resolveLocalContextLength(131072)).toBe(131072);
    expect(resolveLocalContextLength(999999)).toBe(LOCAL_CONTEXT_UI_MAX);
  });

  it('strips stale caps from saved settings instead of inflating them to 256k', () => {
    expect(isStaleAtomContextCap(32768)).toBe(true);
    expect(migrateLocalContextSettings({ context_length: 32768, temperature: 0.7 })).toEqual({
      temperature: 0.7,
    });
    expect(migrateLocalContextSettings({ context_length: 131072, temperature: 0.7 })).toEqual({
      context_length: 131072,
      temperature: 0.7,
    });
    expect(migrateLocalContextSettings({ temperature: 0.7 })).toEqual({ temperature: 0.7 });
  });

  it('lets max_tokens go past the old 32768 slider', () => {
    expect(resolveLocalMaxTokens(32768)).toBe(32768);
    expect(resolveLocalMaxTokens(65536)).toBe(65536);
    expect(resolveLocalMaxTokens(999999)).toBe(LOCAL_MAX_TOKENS_UI_MAX);
  });
});
