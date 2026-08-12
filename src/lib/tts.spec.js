import { describe, it, expect } from 'vitest';
import { plainTextForSpeech, resolveSpeechVoice, shouldAutoSpeakReply, splitTextForTts, clampPlaybackVolume } from './tts.js';
import { deepinfraInferenceUrl } from './api.js';

describe('plainTextForSpeech', () => {
  it('strips thinking blocks and keeps answer text', () => {
    const raw = 'Hello world.';
    expect(plainTextForSpeech(raw)).toBe('Hello world.');
  });

  it('strips markdown links', () => {
    expect(plainTextForSpeech('See [docs](https://example.com) now.')).toBe('See docs now.');
  });
});

describe('splitTextForTts', () => {
  it('splits long text at sentence boundaries', () => {
    const long = 'One. Two. Three. '.repeat(80).trim();
    const parts = splitTextForTts(long, 100);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(' ')).toContain('One.');
  });
});

describe('resolveSpeechVoice', () => {
  it('prefers stored voice URI', () => {
    const voices = [
      { name: 'A', voiceURI: 'a', lang: 'en-US', localService: true },
      { name: 'B', voiceURI: 'b', lang: 'en-GB', localService: false },
    ];
    expect(resolveSpeechVoice(voices, 'b')?.voiceURI).toBe('b');
  });
});

describe('shouldAutoSpeakReply', () => {
  it('speaks during open mic even if the speaker toggle is off', () => {
    expect(shouldAutoSpeakReply({ readAloudEnabled: false, openMicActive: true, roleplayActive: false })).toBe(true);
  });

  it('speaks typed chat only when read-aloud is on', () => {
    expect(shouldAutoSpeakReply({ readAloudEnabled: true, openMicActive: false, roleplayActive: false })).toBe(true);
    expect(shouldAutoSpeakReply({ readAloudEnabled: false, openMicActive: false, roleplayActive: false })).toBe(false);
  });

  it('never speaks over Eve roleplay', () => {
    expect(shouldAutoSpeakReply({ readAloudEnabled: true, openMicActive: true, roleplayActive: true })).toBe(false);
  });
});

describe('deepinfraInferenceUrl', () => {
  it('points at the DeepInfra Kokoro path', () => {
    const url = deepinfraInferenceUrl('/v1/inference/Kokoro-82M/tts');
    expect(url).toMatch(/\/v1\/inference\/Kokoro-82M\/tts$/);
  });
});

describe('clampPlaybackVolume', () => {
  it('clamps to 0–1 and defaults junk to 0.8', () => {
    expect(clampPlaybackVolume(0)).toBe(0);
    expect(clampPlaybackVolume(1)).toBe(1);
    expect(clampPlaybackVolume(1.4)).toBe(1);
    expect(clampPlaybackVolume(-2)).toBe(0);
    expect(clampPlaybackVolume('nope')).toBe(0.8);
  });
});
