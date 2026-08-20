import { describe, it, expect } from 'vitest';
import { getRecommendedSettingsForModel, getDefaultsForModel } from './modelDefaults.js';

describe('Qwen 3.5 Defiant Fable defaults', () => {
  const id =
    '/home/mike/.lmstudio/models/qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf';

  it('uses the card sampler (temp 1, top_k 20, no repeat penalty) and a vision system prompt', () => {
    const rec = getRecommendedSettingsForModel(id);
    expect(rec.temperature).toBe(1);
    expect(rec.top_k).toBe(20);
    expect(rec.repeat_penalty).toBe(1);
    expect(rec.system_prompt.toLowerCase()).toMatch(/vision/);
  });

  it('keeps a practical context window for 9B on local GPUs', () => {
    const d = getDefaultsForModel(id);
    expect(d.family).toBe('qwen35');
    expect(d.context_length).toBe(32768);
  });
});
