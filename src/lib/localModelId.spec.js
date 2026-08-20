import { describe, it, expect } from 'vitest';
import {
  isMmprojGguf,
  ggufBasename,
  diskPathToRouterRelativeId,
  localModelIdsMatch,
  pickInventoryModelId,
  diskPathCoveredByServer,
} from './localModelId.js';

const DISK =
  '/home/mike/.lmstudio/models/qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf';

describe('isMmprojGguf', () => {
  it('detects projector files and ignores chat checkpoints', () => {
    expect(isMmprojGguf('/home/mike/.lmstudio/models/qwen38/mmproj-F16.gguf')).toBe(true);
    expect(isMmprojGguf('mmproj-BF16.gguf')).toBe(true);
    expect(isMmprojGguf(DISK)).toBe(false);
  });
});

describe('diskPathToRouterRelativeId', () => {
  it('strips ~/.lmstudio/models so llama-server gets a relative id', () => {
    expect(diskPathToRouterRelativeId(DISK)).toBe(
      'qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf',
    );
  });

  it('leaves already-relative ids alone', () => {
    expect(diskPathToRouterRelativeId('qwen38/foo.gguf')).toBe('qwen38/foo.gguf');
  });
});

describe('localModelIdsMatch', () => {
  it('matches absolute disk path to relative router id', () => {
    expect(
      localModelIdsMatch(DISK, 'qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf'),
    ).toBe(true);
  });

  it('matches a multimodal bundle folder id', () => {
    expect(localModelIdsMatch(DISK, 'qwen38')).toBe(true);
  });

  it('matches by basename', () => {
    expect(localModelIdsMatch(DISK, ggufBasename(DISK))).toBe(true);
  });
});

describe('pickInventoryModelId', () => {
  it('prefers the full relative path over a folder alias', () => {
    const picked = pickInventoryModelId(DISK, [
      'qwen38',
      'qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf',
      'tinyllama.gguf',
    ]);
    expect(picked).toBe('qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf');
  });

  it('falls back to folder id when that is all the router lists', () => {
    expect(pickInventoryModelId(DISK, ['qwen38', 'other.gguf'])).toBe('qwen38');
  });

  it('falls back to relative path when inventory is empty (post Cursor restart)', () => {
    expect(pickInventoryModelId(DISK, [])).toBe(
      'qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf',
    );
  });

  it('skips mmproj entries', () => {
    expect(pickInventoryModelId(DISK, ['qwen38/mmproj-F16.gguf', 'qwen38'])).toBe('qwen38');
  });
});

describe('diskPathCoveredByServer', () => {
  it('treats a relative router id as covering the absolute disk path', () => {
    expect(diskPathCoveredByServer(DISK, ['qwen38/Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf'])).toBe(
      true,
    );
  });
});
