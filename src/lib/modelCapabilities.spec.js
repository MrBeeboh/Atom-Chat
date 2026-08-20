import { describe, it, expect, beforeEach } from 'vitest';
import {
  getModelCapabilities,
  noteModelVisionCapability,
  clearNotedModelCapabilities,
} from './modelCapabilities.js';

const DEFIANT =
  '/home/mike/.lmstudio/models/qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf';

describe('getModelCapabilities', () => {
  beforeEach(() => {
    clearNotedModelCapabilities();
  });

  it('marks Qwen3.5 Defiant Fable as vision + tools + thinking', () => {
    const caps = getModelCapabilities(DEFIANT);
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.thinking).toBe(true);
  });

  it('marks Qwen3.5 / Qwen3.6 / Qwen3.8 as native multimodal', () => {
    expect(getModelCapabilities('Qwen3.5-9B-Instruct-Q4_K_M.gguf').vision).toBe(true);
    expect(getModelCapabilities('Qwen3.6-27B-Fable-Fusion.gguf').vision).toBe(true);
    expect(getModelCapabilities('Qwen3.8-9B-Distill-Q5_K_M.gguf').vision).toBe(true);
  });

  it('does not treat plain Qwen3 (no decimal minor) as vision', () => {
    expect(getModelCapabilities('Qwen3-8B-Instruct-Q4_K_M.gguf').vision).toBe(false);
    expect(getModelCapabilities('Qwen3-8B-Instruct-Q4_K_M.gguf').tools).toBe(true);
  });

  it('still recognizes explicit VL names', () => {
    expect(getModelCapabilities('qwen3-vl-4b-instruct').vision).toBe(true);
  });

  it('honors vision noted from a sibling mmproj on disk', () => {
    noteModelVisionCapability('/opt/models/mystery-9b.gguf', true);
    expect(getModelCapabilities('/opt/models/mystery-9b.gguf').vision).toBe(true);
    expect(getModelCapabilities('mystery-9b.gguf').vision).toBe(true);
  });
});
