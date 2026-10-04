import { describe, it, expect } from 'vitest';
import { buildOpenRouterIndex } from './modelPricing.js';
import {
  arenaCatalogSize,
  arenaClassIds,
  arenaPickOptions,
  arenaRunPlan,
  arenaShortfallStatus,
  pickArenaLineup,
} from './arenaPick.js';

describe('arena pick classes', () => {
  it('uses thinking, tools, and vision flags and does not invent a text class', () => {
    expect(arenaClassIds('cerebras:zai-glm-4.7')).toContain('reasoner');
    expect(arenaClassIds('picture-only', null, { vision: true })).toEqual(['vision']);
    expect(arenaClassIds('mystery-blob', null, { tools: true })).toEqual(['tools']);
    expect(arenaClassIds('mystery-blob')).toEqual([]);
    expect(arenaClassIds('mystery-blob')).not.toContain('text');
  });

  it('does not put a model in a class it does not have', () => {
    const ids = arenaClassIds('picture-only', null, { vision: true });
    expect(ids).toEqual(['vision']);
  });
});

describe('arena pick size', () => {
  it('reads context_length and ignores a missing parameter field', () => {
    const catalog = { index: buildOpenRouterIndex([
      { id: 'acme/text-1', context_length: 128000, pricing: { prompt: '0', completion: '0' } },
    ]) };
    expect(arenaCatalogSize('nous:acme/text-1', catalog)).toEqual({ context: 128000, parameters: null });
    expect(arenaCatalogSize('local-gguf', catalog)).toEqual({ context: null, parameters: null });
  });

  it('reads a parameter count only when the catalog row has that field', () => {
    const catalog = { index: buildOpenRouterIndex([
      { id: 'acme/big', context_length: 8192, parameter_count: 70000000000, pricing: {} },
    ]) };
    expect(arenaCatalogSize('nous:acme/big', catalog).parameters).toBe(70000000000);
  });

  it('offers only classes and sizes that the rows actually have', () => {
    const catalog = { index: buildOpenRouterIndex([
      { id: 'zai-glm-4.7', context_length: 8192, pricing: {} },
    ]) };
    const options = arenaPickOptions([{ id: 'cerebras:zai-glm-4.7' }, { id: 'mystery-blob' }], catalog);
    expect(options.classes.map((c) => c.id)).toContain('reasoner');
    expect(options.classes.map((c) => c.id)).not.toContain('text');
    expect(options.sizes.map((c) => c.label)).toEqual(['Under 32K']);
    expect(options.contextNote).toBe('Under 32K');
  });
});

describe('arena lineup quantity', () => {
  it('fills only as many as exist and says so', () => {
    const lineup = pickArenaLineup({
      models: [{ id: 'cerebras:zai-glm-4.7' }],
      catalog: null,
      arena: 'text',
      quantity: 4,
      random: () => 0,
    });
    expect(lineup.ids).toEqual(['cerebras:zai-glm-4.7']);
    expect(lineup.available).toBe(1);
    expect(lineup.quantity).toBe(4);
    expect(arenaShortfallStatus(lineup)).toBe('Only 1 model can sit in the Text arena. Running 1.');
  });

  it('vision arena keeps only models with the vision flag', () => {
    const lineup = pickArenaLineup({
      models: [{ id: 'grok:grok-imagine-image' }, { id: 'cerebras:zai-glm-4.7' }],
      catalog: null,
      arena: 'vision',
      quantity: 2,
      random: () => 0,
    });
    expect(lineup.ids).toEqual(['grok:grok-imagine-image']);
  });

  it('text arena does not drop a model for class or context bucket', () => {
    const lineup = pickArenaLineup({
      models: [{ id: 'grok:grok-imagine-image' }, { id: 'cerebras:zai-glm-4.7' }],
      catalog: null,
      arena: 'text',
      classId: 'vision',
      sizeId: 'ctx:over-128k',
      quantity: 2,
      random: () => 0.99,
    });
    expect(lineup.ids.slice().sort()).toEqual(['cerebras:zai-glm-4.7', 'grok:grok-imagine-image']);
    const code = pickArenaLineup({
      models: [{ id: 'cerebras:zai-glm-4.7' }],
      arena: 'code',
      quantity: 2,
      random: () => 0,
    });
    expect(code.ids).toEqual(['cerebras:zai-glm-4.7']);
    expect(code.arena).toBe('code');
  });
});

describe('context size buckets', () => {
  it('groups real context lengths and omits empty buckets', () => {
    const catalog = { index: buildOpenRouterIndex([
      { id: 'acme/small', context_length: 4096, pricing: {} },
      { id: 'acme/mid', context_length: 128000, pricing: {} },
      { id: 'acme/huge', context_length: 200000, pricing: {} },
    ]) };
    const options = arenaPickOptions([
      { id: 'nous:acme/small', caps: { thinking: true } },
      { id: 'nous:acme/mid', caps: { thinking: true } },
      { id: 'nous:acme/huge', caps: { thinking: true } },
    ], catalog, 'reasoner');
    expect(options.sizes.map((s) => s.label)).toEqual(['Under 32K', '32K to 128K', 'Over 128K']);
  });

  it('omits a bucket no model uses', () => {
    const catalog = { index: buildOpenRouterIndex([
      { id: 'acme/huge', context_length: 200000, pricing: {} },
    ]) };
    const options = arenaPickOptions([{ id: 'nous:acme/huge', caps: { tools: true } }], catalog, 'tools');
    expect(options.sizes.map((s) => s.id)).toEqual(['ctx:over-128k']);
  });

  it('uses one parameter control only when context length is absent', () => {
    const catalog = { index: buildOpenRouterIndex([
      { id: 'acme/params', parameter_count: 70, pricing: {} },
      { id: 'acme/both', context_length: 8192, parameter_count: 7, pricing: {} },
    ]) };
    const paramsOnly = arenaPickOptions([{ id: 'nous:acme/params', caps: { vision: true } }], catalog);
    expect(paramsOnly.sizes).toEqual([]);
    expect(paramsOnly.contextNote).toBe('not listed');
    const both = arenaPickOptions([{ id: 'nous:acme/both', caps: { vision: true } }], catalog);
    expect(both.sizes.map((s) => s.id)).toEqual(['ctx:under-32k']);
  });

  it('picks models inside the selected bucket', () => {
    const catalog = { index: buildOpenRouterIndex([
      { id: 'acme/small', context_length: 8192, pricing: {} },
      { id: 'acme/huge', context_length: 200000, pricing: {} },
    ]) };
    const lineup = pickArenaLineup({
      models: [
        { id: 'nous:acme/small', caps: { thinking: true } },
        { id: 'nous:acme/huge', caps: { thinking: true } },
      ],
      catalog,
      classId: 'reasoner',
      sizeId: 'ctx:over-128k',
      quantity: 4,
    });
    expect(lineup.ids.slice().sort()).toEqual(['nous:acme/huge', 'nous:acme/small']);
    expect(arenaRunPlan({
      arena: 'text',
      quantity: 4,
      available: 4,
    })).toBe('');
    expect(arenaRunPlan({ mode: 'named' })).toBe('');
    expect(arenaRunPlan({
      arena: 'text',
      quantity: 4,
      available: 2,
    })).toBe('Only 2 models in the text arena. Running 2.');
  });
});
