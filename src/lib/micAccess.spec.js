import { describe, it, expect } from 'vitest';
import { micErrorMessage, audioConstraints, pickRecorderMime } from './micAccess.js';

describe('micErrorMessage', () => {
  it('maps NotFoundError to actionable guidance', () => {
    const msg = micErrorMessage(new DOMException('Requested device not found', 'NotFoundError'));
    expect(msg).toContain('No microphone found');
    expect(msg).toContain('Settings');
  });

  it('maps permission errors', () => {
    expect(micErrorMessage({ name: 'NotAllowedError', message: 'denied' })).toContain('blocked');
  });

  it('falls back to message text', () => {
    expect(micErrorMessage({ name: 'Unknown', message: 'Something odd' })).toBe('Something odd');
  });
});

describe('audioConstraints', () => {
  it('uses exact deviceId when set', () => {
    expect(audioConstraints('abc-123')).toEqual({ audio: { deviceId: { exact: 'abc-123' } } });
  });

  it('uses browser default when empty', () => {
    expect(audioConstraints('')).toEqual({ audio: true });
    expect(audioConstraints('default')).toEqual({ audio: true });
  });

  it('merges extra track constraints', () => {
    expect(audioConstraints('', { echoCancellation: true })).toEqual({
      audio: { echoCancellation: true },
    });
  });
});

describe('pickRecorderMime', () => {
  it('returns a string (possibly empty in test env)', () => {
    expect(typeof pickRecorderMime()).toBe('string');
  });
});
