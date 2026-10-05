import { describe, it, expect } from 'vitest';
import { buildOpenRouterIndex } from './modelPricing.js';
import { prepareArenaModelList } from './arenaModelList.js';

describe('prepareArenaModelList', () => {
  it('keeps one row per id and prefers the row with capability data', () => {
    const rows = prepareArenaModelList([
      { id: 'FooModel', origin: 'fallback' },
      { id: 'foomodel', origin: 'live', caps: { tools: true } },
      { id: 'FOOMODEL', origin: 'fallback' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['foomodel']);
    expect(rows[0].caps.tools).toBe(true);
    expect(rows[0].origin).toBe('live');
  });

  it('collapses the same model listed by two sources and keeps the priced live row', () => {
    const catalog = {
      index: buildOpenRouterIndex([
        {
          id: 'x-ai/grok-4.6',
          pricing: { prompt: '0.000002', completion: '0.000006' },
          supported_parameters: ['tools', 'reasoning'],
        },
      ]),
    };
    const rows = prepareArenaModelList(
      [
        { id: 'nous:x-ai/grok-4.6', origin: 'fallback' },
        { id: 'grok:grok-4.6', origin: 'live' },
      ],
      catalog,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('grok:grok-4.6');
  });

  it('drops rows with no known type and keeps live Qwen3.8-Flash-Next', () => {
    const rows = prepareArenaModelList([
      { id: 'mystery-blob' },
      { id: 'nous:stealth/ox-alpha', origin: 'fallback' },
      { id: 'Qwen3.8-Flash-Next' },
      { id: '/home/mike/models/by-model/qwen3.8-flash-next/QWEN3.8-FLASH-NEXT-UD-Q3_K_XL-00001-OF-00003.GGUF' },
      { id: 'grok:grok-imagine-video' },
    ]);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain('mystery-blob');
    expect(ids).not.toContain('nous:stealth/ox-alpha');
    expect(ids).toContain('Qwen3.8-Flash-Next');
    expect(ids).not.toContain('/home/mike/models/by-model/qwen3.8-flash-next/QWEN3.8-FLASH-NEXT-UD-Q3_K_XL-00001-OF-00003.GGUF');
    expect(ids).toContain('grok:grok-imagine-video');
  });

  it('keeps a Flash-Next shard when that is the only live row', () => {
    const shard = '/home/mike/models/QWEN3.8-FLASH-NEXT-UD-Q3_K_XL-00001-OF-00003.GGUF';
    const rows = prepareArenaModelList([{ id: shard }]);
    expect(rows.map((r) => r.id)).toEqual([shard]);
  });
  it('keeps local Muse Glimmer when the row has no capability fields', () => {
    const id = 'Muse-Glimmer-30B-KQuant-Dynamic-Q4_K_XL';
    const rows = prepareArenaModelList([{ id }]);
    expect(rows.map((r) => r.id)).toEqual([id]);
  });

  it('keeps exactly one MiMo row even if Q4 and Q8 both appear, preferring the capped live row', () => {
    const rows = prepareArenaModelList([
      { id: 'MiMo-V2.6-Distill-Qwen-9B-Q4_K_M', origin: 'fallback' },
      { id: 'MiMo-V2.6-Distill-Qwen-9B-Q8_0', origin: 'live', caps: { vision: true, tools: true, thinking: true } },
      { id: 'mystery-blob' },
    ]);
    const mimo = rows.filter((r) => /mimo/i.test(r.id));
    expect(mimo).toHaveLength(1);
    expect(mimo[0].id).toBe('MiMo-V2.6-Distill-Qwen-9B-Q8_0');
    expect(rows.map((r) => r.id)).not.toContain('mystery-blob');
  });

  it('includes MiMo even when the live /v1/models row has text-only modalities (name heuristic)', () => {
    const rows = prepareArenaModelList([
      {
        id: 'MiMo-V2.6-Distill-Qwen-9B-Q8_0',
        origin: 'live',
        architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['MiMo-V2.6-Distill-Qwen-9B-Q8_0']);
  });
});

