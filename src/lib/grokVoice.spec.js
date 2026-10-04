import { describe, it, expect } from 'vitest';
import {
  appendTranscriptDelta,
  buildRoleplayInstructions,
  extractAudioDelta,
  extractVoiceClientToken,
  isGrokVoiceModel,
  XAI_VOICES,
} from './grokVoice.js';

describe('grokVoice', () => {
  it('buildRoleplayInstructions merges base prompt and scenario', () => {
    const out = buildRoleplayInstructions('You are a pirate.', 'The user is your first mate.');
    expect(out).toContain('You are a pirate.');
    expect(out).toContain('The user is your first mate.');
    expect(out).toContain('spoken dialogue');
  });

  it('exports Eve as a voice option', () => {
    expect(XAI_VOICES.some((v) => v.id === 'eve')).toBe(true);
  });

  it('detects grok voice model ids', () => {
    expect(isGrokVoiceModel('grok-voice:eve')).toBe(true);
    expect(isGrokVoiceModel('grok:grok-voice-latest')).toBe(true);
    expect(isGrokVoiceModel('grok:grok-voice-think-fast-2.0')).toBe(true);
    expect(isGrokVoiceModel('grok:grok-4.6')).toBe(false);
  });

  it('joins word-sized transcript deltas', () => {
    expect(appendTranscriptDelta('I was', 'just')).toBe('I was just');
    expect(appendTranscriptDelta('Hello, ', 'there')).toBe('Hello, there');
    expect(appendTranscriptDelta('Hi', ' there')).toBe('Hi there');
  });

  it('extracts audio and token payloads from several shapes', () => {
    expect(extractAudioDelta({ delta: 'AAAAAAAAAAAAAAAAAAAA' })).toBe('AAAAAAAAAAAAAAAAAAAA');
    expect(extractAudioDelta({ output_audio: { audio: 'AAAAAAAAAAAAAAAAAAAA' } })).toBe('AAAAAAAAAAAAAAAAAAAA');
    expect(extractVoiceClientToken({ value: ' tok ' })).toBe('tok');
    expect(extractVoiceClientToken({ client_secret: { value: 'abc' } })).toBe('abc');
    expect(extractVoiceClientToken({ token: 'xyz' })).toBe('xyz');
  });
});
