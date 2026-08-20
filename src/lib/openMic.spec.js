import { describe, it, expect } from 'vitest';
import { isUsefulTranscript, waitUntilReplySpoken } from './openMic.js';

describe('isUsefulTranscript', () => {
  it('accepts real sentences', () => {
    expect(isUsefulTranscript('What is the weather in Portland?')).toBe(true);
    expect(isUsefulTranscript('ok go')).toBe(true);
  });

  it('drops empty and whisper junk', () => {
    expect(isUsefulTranscript('')).toBe(false);
    expect(isUsefulTranscript('  ')).toBe(false);
    expect(isUsefulTranscript('.')).toBe(false);
    expect(isUsefulTranscript('Thank you.')).toBe(false);
    expect(isUsefulTranscript('Thanks for watching.')).toBe(false);
    expect(isUsefulTranscript('um')).toBe(false);
  });
});

describe('waitUntilReplySpoken', () => {
  it('waits for streaming then TTS, then a trailing gap', async () => {
    let streaming = true;
    let ttsBusy = false;
    const sleeps = [];
    const p = waitUntilReplySpoken({
      isStreaming: () => streaming,
      isTtsBusy: () => ttsBusy,
      ttsStartGraceMs: 80,
      afterTtsMs: 40,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (streaming) streaming = false;
        else if (!ttsBusy && sleeps.length < 6) ttsBusy = true;
        else ttsBusy = false;
      },
    });
    await p;
    expect(sleeps.length).toBeGreaterThan(2);
    expect(sleeps.at(-1)).toBe(40);
  });

  it('returns after grace if TTS never starts', async () => {
    const sleeps = [];
    await waitUntilReplySpoken({
      isStreaming: () => false,
      isTtsBusy: () => false,
      ttsStartGraceMs: 50,
      afterTtsMs: 25,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps.at(-1)).toBe(25);
  });

  it('stops immediately when cancelled', async () => {
    let n = 0;
    await waitUntilReplySpoken({
      cancelled: () => true,
      isStreaming: () => true,
      isTtsBusy: () => true,
      sleep: async () => {
        n += 1;
      },
    });
    expect(n).toBe(0);
  });
});

describe('isUsefulTranscript', () => {
  it('accepts real sentences', () => {
    expect(isUsefulTranscript('What is the weather in Portland?')).toBe(true);
    expect(isUsefulTranscript('ok go')).toBe(true);
  });

  it('drops empty and whisper junk', () => {
    expect(isUsefulTranscript('')).toBe(false);
    expect(isUsefulTranscript('  ')).toBe(false);
    expect(isUsefulTranscript('.')).toBe(false);
    expect(isUsefulTranscript('Thank you.')).toBe(false);
    expect(isUsefulTranscript('Thanks for watching.')).toBe(false);
    expect(isUsefulTranscript('um')).toBe(false);
  });
});
