import { describe, it, expect } from 'vitest'
import { getModelCapabilities } from './modelCapabilities.js'
import { shouldSkipImageResizeForVision } from './utils.js'
import { scanLocalGgufModels, defaultModelScanRoots } from '../../scripts/local-disk-models.mjs'

describe('getModelCapabilities', () => {
  it('detects Qwen3.5 text models as tools/thinking but not vision', () => {
    const id = 'Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-Q4_K_M.gguf'
    const caps = getModelCapabilities(id)
    expect(caps.vision).toBe(false)
    expect(caps.tools).toBe(true)
    expect(caps.thinking).toBe(true)
  })

  it('detects Qwen3-VL and Qwen3.5-VL as vision', () => {
    expect(getModelCapabilities('qwen3-vl-8b-instruct').vision).toBe(true)
    expect(getModelCapabilities('Qwen3.5-VL-4B-Instruct-Q4_K_M.gguf').vision).toBe(true)
  })

  it('detects other common VLMs', () => {
    expect(getModelCapabilities('llava-v1.6-mistral-7b').vision).toBe(true)
    expect(getModelCapabilities('MiniCPM-V-2_6-Q4_K_M.gguf').vision).toBe(true)
    expect(getModelCapabilities('internvl2-8b').vision).toBe(true)
    expect(getModelCapabilities('llama-3.2-11b-vision-instruct').vision).toBe(true)
  })
})

describe('shouldSkipImageResizeForVision', () => {
  it('skips resize for all Qwen-VL variants', () => {
    expect(shouldSkipImageResizeForVision('qwen2-vl-7b')).toBe(true)
    expect(shouldSkipImageResizeForVision('Qwen3.5-VL-8B')).toBe(true)
    expect(shouldSkipImageResizeForVision('mistral-7b')).toBe(false)
  })
})

describe('local disk model scanner', () => {
  it('includes standard scan roots', () => {
    const roots = defaultModelScanRoots()
    expect(roots.some((r) => r.includes('.lmstudio'))).toBe(true)
    expect(roots.some((r) => r.includes('huggingface'))).toBe(true)
  })

  it('returns an array (may be empty in CI)', () => {
    const models = scanLocalGgufModels([])
    expect(Array.isArray(models)).toBe(true)
  })
})
