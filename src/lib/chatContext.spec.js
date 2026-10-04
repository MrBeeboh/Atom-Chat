import { describe, expect, it } from 'vitest';
import {
  estimateMessagesTokens,
  fitMessagesToContext,
  needsCompress,
  splitHeadForCompress,
} from './chatContext.js';

function msg(role, content) {
  return { role, content };
}

describe('fitMessagesToContext', () => {
  it('leaves a short thread alone', () => {
    const messages = [
      msg('system', 'You are helpful.'),
      msg('user', 'Hi'),
      msg('assistant', 'Hello'),
      msg('user', 'Go on'),
    ];
    const out = fitMessagesToContext(messages, { nCtx: 8192, maxTokens: 4096 });
    expect(out.dropped).toBe(0);
    expect(out.overflow).toBe(false);
    expect(out.messages).toEqual(messages);
  });

  it('drops oldest turns and keeps system + the latest user message', () => {
    const oldUser = msg('user', 'A'.repeat(12000));
    const oldAsst = msg('assistant', 'B'.repeat(12000));
    const latest = msg('user', 'Make some changes.');
    const messages = [msg('system', 'sys'), oldUser, oldAsst, latest];
    const out = fitMessagesToContext(messages, { nCtx: 8192, maxTokens: 4096 });
    expect(out.dropped).toBeGreaterThan(0);
    expect(out.overflow).toBe(false);
    expect(out.messages[0]).toEqual(msg('system', 'sys'));
    expect(out.messages.at(-1)).toEqual(latest);
    expect(out.messages).not.toContain(oldUser);
    expect(out.tokens).toBeLessThanOrEqual(out.budget);
  });

  it('flags overflow when the last user message alone cannot fit', () => {
    const latest = msg('user', 'Z'.repeat(40000));
    const out = fitMessagesToContext([msg('system', 'sys'), latest], {
      nCtx: 8192,
      maxTokens: 4096,
    });
    expect(out.overflow).toBe(true);
    expect(out.messages.at(-1)).toEqual(latest);
  });

  it('counts image parts as extra tokens', () => {
    const n = estimateMessagesTokens([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } },
        ],
      },
    ]);
    expect(n).toBeGreaterThan(256);
  });

  it('flags compress when the thread is 70% of the window', () => {
    expect(needsCompress(1000, 8192)).toBe(false);
    expect(needsCompress(6000, 8192)).toBe(true);
  });

  it('splits a long thread into a head to summarize and recent keep', () => {
    const messages = [];
    for (let i = 0; i < 12; i += 1) {
      messages.push(msg('user', `Q${i} ${'x'.repeat(800)}`));
      messages.push(msg('assistant', `A${i} ${'y'.repeat(800)}`));
    }
    messages.push(msg('user', 'latest'));
    const { head, keep } = splitHeadForCompress(messages, { nCtx: 8192, keepTokens: 800 });
    expect(head.length).toBeGreaterThan(0);
    expect(keep.at(-1)).toEqual(msg('user', 'latest'));
    expect(head).not.toContainEqual(msg('user', 'latest'));
  });
});
