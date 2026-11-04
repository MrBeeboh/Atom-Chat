import { describe, it, expect } from 'vitest';
import {
  appendTranscriptDelta,
  buildVoiceSessionConfig,
  extractAudioDelta,
  extractVoiceClientToken,
  isGrokVoiceModel,
  resolveVoiceAgentPrompt,
  DEFAULT_VOICE_AGENT_PROMPT,
  DEFAULT_VOICE_ID,
  XAI_VOICES,
} from './grokVoice.js';

describe('grokVoice', () => {
  it('sends the settings prompt as the voice session instructions', () => {
    const prompt = 'You are a radio dispatcher. Keep replies under two sentences.';
    const session = buildVoiceSessionConfig(DEFAULT_VOICE_ID, prompt, 24000);
    expect(session.instructions).toBe(prompt);
    expect(session.voice).toBe('eve');
    expect(session.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
    expect(session.turn_detection).toEqual({ type: 'server_vad', silence_duration_ms: 600 });
  });

  it('uses the default talk prompt when the setting is blank', () => {
    expect(resolveVoiceAgentPrompt('  ')).toBe(DEFAULT_VOICE_AGENT_PROMPT);
    expect(buildVoiceSessionConfig('eve', '').instructions).toBe(DEFAULT_VOICE_AGENT_PROMPT);
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
