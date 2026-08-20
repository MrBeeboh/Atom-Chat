import { describe, it, expect } from 'vitest';
import { guessHfModelId } from './huggingface.js';

describe('guessHfModelId', () => {
  it('maps Defiant Fable GGUF names to the DavidAU vision repo', () => {
    expect(
      guessHfModelId(
        'Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf',
      ),
    ).toBe('DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF');
  });
});
