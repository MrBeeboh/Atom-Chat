import { describe, it, expect } from 'vitest';
import {
  estimateVramGb,
  planArenaResidents,
  modelsToUnload,
  sameLocalModel,
  isResidentModel,
  localModelKey,
  orderSwapRows,
  DEFAULT_VRAM_GB,
} from './arenaResidentModels.js';

describe('estimateVramGb', () => {
  it('returns 0 for cloud models', () => {
    expect(estimateVramGb('deepseek:deepseek-chat')).toBe(0);
  });

  it('knows Flash-Next and Coder-Next aliases are huge', () => {
    expect(estimateVramGb('Qwen3.8-Flash-Next')).toBeGreaterThan(64);
    expect(estimateVramGb('QWEN3-CODER-NEXT-Q4_K_M')).toBeGreaterThan(40);
  });

  it('returns null for ids with no size', () => {
    expect(estimateVramGb('my-mystery-model')).toBeNull();
  });

  it('scales with parameter count', () => {
    const small = estimateVramGb('Qwen3.5-9B-Instruct-Q4_K_M.gguf');
    const large = estimateVramGb('Qwen3-32B-Instruct-Q4_K_M.gguf');
    expect(small).toBeGreaterThan(4);
    expect(small).toBeLessThan(10);
    expect(large).toBeGreaterThan(small);
  });
});

describe('sameLocalModel', () => {
  it('matches basename of an absolute path to a server id', () => {
    expect(
      sameLocalModel(
        '/home/x/.cache/huggingface/hub/Qwen3.5-9B-Q4_K_M.gguf',
        'Qwen3.5-9B-Q4_K_M.gguf',
      ),
    ).toBe(true);
  });
});

describe('modelsToUnload', () => {
  it('keeps residents and unloads the rest', () => {
    const loaded = ['big-9b.gguf', 'tiny-1b.gguf'];
    const keep = ['/models/big-9b.gguf'];
    expect(modelsToUnload(loaded, keep)).toEqual(['tiny-1b.gguf']);
  });
});

describe('planArenaResidents', () => {
  it('pins every local model when they all fit', () => {
    const plan = planArenaResidents({
      modelIds: [
        'Qwen3.5-9B-Q4_K_M.gguf',
        'phi-3-mini-3.8b-Q4_K_M.gguf',
        'deepseek:deepseek-chat',
      ],
      vramTotalGb: 24,
      gpuCount: 1,
    });
    expect(plan.cloud).toEqual(['deepseek:deepseek-chat']);
    expect(plan.swap).toEqual([]);
    expect(plan.residents).toHaveLength(2);
    expect(plan.parallelLocals).toBe(false);
  });

  it('keeps the largest resident and swaps smaller ones when VRAM is tight', () => {
    const plan = planArenaResidents({
      modelIds: [
        'Qwen3-32B-Instruct-Q4_K_M.gguf',
        'Qwen3.5-9B-Q4_K_M.gguf',
        'phi-3-mini-3.8b-Q4_K_M.gguf',
      ],
      vramTotalGb: 32,
      gpuCount: 1,
      headroomFraction: 0.2,
    });
    expect(plan.residents.length).toBeGreaterThanOrEqual(1);
    expect(isResidentModel(plan, 'Qwen3-32B-Instruct-Q4_K_M.gguf') || plan.swap.length > 0).toBe(true);
    expect(plan.usedGb + 0.01).toBeLessThanOrEqual(plan.budgetGb + 0.05);
  });

  it('enables parallel local inference when two GPUs can hold two residents', () => {
    const plan = planArenaResidents({
      modelIds: ['Qwen3.5-9B-Q4_K_M.gguf', 'llama-3.1-8b-instruct-Q4_K_M.gguf'],
      vramTotalGb: 32,
      gpuCount: 2,
    });
    expect(plan.residents).toHaveLength(2);
    expect(plan.parallelLocals).toBe(true);
    expect(plan.gpuCount).toBe(2);
  });

  it('uses the default VRAM budget when metrics are missing', () => {
    const plan = planArenaResidents({
      modelIds: ['Qwen3.5-9B-Q4_K_M.gguf'],
    });
    expect(plan.vramTotalGb).toBe(DEFAULT_VRAM_GB);
    expect(plan.residents).toEqual(['Qwen3.5-9B-Q4_K_M.gguf']);
  });

  it('runs one at a time when a model is bigger than one card', () => {
    const plan = planArenaResidents({
      modelIds: ['Qwen3-70B-Instruct-Q4_K_M.gguf', 'Qwen3.5-9B-Q4_K_M.gguf'],
      vramTotalGb: 16,
      gpuCount: 1,
      headroomFraction: 0.2,
    });
    expect(plan.residents).toEqual([]);
    expect(plan.swap).toHaveLength(2);
    expect(plan.exclusive).toEqual(['Qwen3-70B-Instruct-Q4_K_M.gguf']);
  });

  it('never co-loads Flash-Next with the 80B router model on dual B70', () => {
    const plan = planArenaResidents({
      modelIds: ['Qwen3.8-Flash-Next', 'QWEN3-CODER-NEXT-Q4_K_M'],
      vramTotalGb: 64,
      gpuCount: 2,
    });
    expect(plan.residents).toEqual([]);
    expect(plan.parallelLocals).toBe(false);
    expect(plan.exclusive).toEqual(expect.arrayContaining(['Qwen3.8-Flash-Next', 'QWEN3-CODER-NEXT-Q4_K_M']));
  });

  it('treats a sizeless alias as needing the whole box instead of guessing small', () => {
    const plan = planArenaResidents({
      modelIds: ['my-mystery-model', 'Qwen3.5-9B-Q4_K_M.gguf'],
      vramTotalGb: 64,
      gpuCount: 2,
    });
    expect(plan.residents).toEqual([]);
    expect(plan.exclusive).toEqual(['my-mystery-model']);
  });

  it('pins single-card models against one card, not the sum of both', () => {
    const plan = planArenaResidents({
      modelIds: ['Qwen3-14B-Q4_K_M.gguf', 'gemma-3-27b-it-Q4_K_M.gguf'],
      vramTotalGb: 64,
      gpuCount: 2,
    });
    expect(plan.budgetGb).toBeCloseTo(25.6, 1);
    expect(plan.residents.length).toBeLessThan(2);
  });

  it('never pins cloud ids as residents', () => {
    const plan = planArenaResidents({
      modelIds: ['grok:grok-4', 'deepseek:deepseek-chat'],
      vramTotalGb: 48,
      gpuCount: 2,
    });
    expect(plan.residents).toEqual([]);
    expect(plan.cloud).toHaveLength(2);
  });
});

describe('orderSwapRows', () => {
  it('runs the model already in VRAM first', () => {
    const rows = [
      { slot: 'A', modelId: 'Qwen3.8-Flash-Next' },
      { slot: 'B', modelId: 'QWEN3-CODER-NEXT-Q4_K_M' },
    ];
    expect(orderSwapRows(rows, ['QWEN3-CODER-NEXT-Q4_K_M']).map((r) => r.slot)).toEqual(['B', 'A']);
    expect(orderSwapRows(rows, []).map((r) => r.slot)).toEqual(['A', 'B']);
  });
});

describe('localModelKey', () => {
  it('strips directories', () => {
    expect(localModelKey('/a/b/c.gguf')).toBe('c.gguf');
  });
});
