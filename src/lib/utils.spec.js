import { describe, it, expect } from 'vitest'
import { generateId, formatTime } from './utils.js'

describe('utils', () => {
  it('generateId returns a string', () => {
    expect(typeof generateId()).toBe('string')
    expect(generateId()).not.toBe(generateId())
  })

  it('formatTime returns "Just now" for recent dates', () => {
    expect(formatTime(new Date())).toBe('Just now')
  })
})
