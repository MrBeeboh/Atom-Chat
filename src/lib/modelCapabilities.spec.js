import { describe, it, expect } from 'vitest';
import { buildOpenRouterIndex } from './modelPricing.js';
import { endpointCapsFromRow, getModelCapabilities, listedModelCaps } from './modelCapabilities.js';

describe('model capability marks', () => {
  it('keeps vision from llama.cpp architecture even when the id has no vl token', () => {
    const row = { id: 'Qwen3.8-27B-Q4_K_M', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } };
    const caps = endpointCapsFromRow(row);
    expect(caps.vision).toBe(true);
    expect(getModelCapabilities('Qwen3.8-27B-Q4_K_M').vision).toBe(false);
    expect(getModelCapabilities('Qwen3.8-27B-Q4_K_M', null, caps).vision).toBe(true);
    expect(getModelCapabilities('Qwen3.8-27B-Q4_K_M', null, caps).thinking).toBe(true);
  });

  it('does not invent vision when modalities are empty or text-only', () => {
    expect(endpointCapsFromRow({ architecture: { input_modalities: [], output_modalities: [] } })).toBeNull();
    expect(endpointCapsFromRow({ architecture: { input_modalities: ['text'] } }).vision).toBe(false);
    expect(getModelCapabilities('Ornith-1.5-35B-Q4_K_M', null, { vision: false }).vision).toBe(false);
  });

  it('keeps vision from llama.cpp /props modalities and /models capabilities', () => {
    expect(endpointCapsFromRow({ modalities: { vision: true, video: true, audio: false } }).vision).toBe(true);
    expect(endpointCapsFromRow({ modalities: { vision: false, video: false } }).vision).toBe(false);
    expect(endpointCapsFromRow({ name: 'Qwen3.8-Flash-Next', capabilities: ['completion', 'multimodal'] }).vision).toBe(true);
    expect(getModelCapabilities('Qwen3.8-Flash-Next').vision).toBe(false);
    expect(
      listedModelCaps('Qwen3.8-Flash-Next', [{ id: 'Qwen3.8-Flash-Next', caps: { vision: true } }]).vision,
    ).toBe(true);
  });

  it('adds tools, vision, and thinking from the OpenRouter row already used for prices', () => {
    const index = buildOpenRouterIndex([
      {
        id: 'moonshotai/kimi-k3',
        architecture: { modality: 'text+image->text', input_modalities: ['text', 'image'] },
        supported_parameters: ['tools', 'reasoning', 'temperature'],
        reasoning: { mandatory: false },
        pricing: { prompt: '0.000001', completion: '0.000002' },
      },
    ]);
    const caps = getModelCapabilities('nous:moonshotai/kimi-k3', { index });
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.thinking).toBe(true);
    const bare = getModelCapabilities('nous:moonshotai/kimi-k3', null);
    expect(bare.vision).toBe(false);
    expect(bare.tools).toBe(false);
    expect(bare.thinking).toBe(false);
  });

  it('shows vision and thinking icons from type tags the app already assigns', () => {
    expect(getModelCapabilities('grok:grok-imagine-video').vision).toBe(true);
    expect(getModelCapabilities('grok:grok-imagine-image').vision).toBe(true);
    expect(getModelCapabilities('cerebras:zai-glm-4.7').thinking).toBe(true);
    expect(getModelCapabilities('deepseek:deepseek-v4-pro').thinking).toBe(true);
  });

  it('uses an explicit tools flag and does not invent one when the row has no capability data', () => {
    expect(getModelCapabilities('mystery-blob', null, { tools: true }).tools).toBe(true);
    const bare = getModelCapabilities('mystery-blob');
    expect(bare.tools).toBe(false);
    expect(bare.vision).toBe(false);
    expect(bare.thinking).toBe(false);
    expect(bare.json).toBe(false);
  });

  it('marks MiMo-V2.6 Distill as vision + tools + thinking from the id alone', () => {
    const caps = getModelCapabilities('MiMo-V2.6-Distill-Qwen-9B-Q8_0');
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.thinking).toBe(true);
  });
});
