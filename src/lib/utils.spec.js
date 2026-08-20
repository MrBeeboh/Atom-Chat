import { describe, it, expect } from 'vitest'
import { generateId, formatTime, messageContentToText, makeSearchSnippet, shouldSkipImageResizeForVision } from './utils.js'

describe('utils', () => {
  it('generateId returns a string', () => {
    expect(typeof generateId()).toBe('string')
    expect(generateId()).not.toBe(generateId())
  })

  it('formatTime returns "Just now" for recent dates', () => {
    expect(formatTime(new Date())).toBe('Just now')
  })
})

describe('messageContentToText', () => {
  it('passes through plain strings', () => {
    expect(messageContentToText('hello')).toBe('hello')
  })

  it('joins text parts and skips image parts', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,xyz' } },
      { type: 'text', text: 'second' },
    ]
    expect(messageContentToText(content)).toBe('first\nsecond')
  })

  it('returns empty string for null/undefined/objects', () => {
    expect(messageContentToText(null)).toBe('')
    expect(messageContentToText(undefined)).toBe('')
    expect(messageContentToText({})).toBe('')
  })
})

describe('makeSearchSnippet', () => {
  it('returns empty string when there is no match', () => {
    expect(makeSearchSnippet('hello world', 'zebra')).toBe('')
    expect(makeSearchSnippet('', 'x')).toBe('')
    expect(makeSearchSnippet('text', '')).toBe('')
  })

  it('matches case-insensitively and returns context around the match', () => {
    const snippet = makeSearchSnippet('The QUICK brown fox', 'quick')
    expect(snippet).toContain('QUICK')
    expect(snippet).toContain('brown fox')
  })

  it('adds ellipses when the snippet is truncated', () => {
    const long = 'a'.repeat(100) + ' needle ' + 'b'.repeat(100)
    const snippet = makeSearchSnippet(long, 'needle')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('needle')
  })

  it('collapses whitespace/newlines into single spaces', () => {
    const snippet = makeSearchSnippet('line one\n\nneedle here\tend', 'needle')
    expect(snippet).toBe('line one needle here end')
  })
})

describe('shouldSkipImageResizeForVision', () => {
  it('skips resize for native Qwen 3.5 GGUFs', () => {
    expect(
      shouldSkipImageResizeForVision(
        'Qwen3.5-9B-The-Defiant-Fable-Uncnr-Heretic-NEO-MAX-MTP-Q5_K_M.gguf',
      ),
    ).toBe(true)
  })

  it('does not skip for unrelated text models', () => {
    expect(shouldSkipImageResizeForVision('llama-3.1-8b-instruct')).toBe(false)
  })
})
