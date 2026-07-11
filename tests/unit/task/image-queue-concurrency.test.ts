import { describe, expect, it } from 'vitest'
import { readImageQueueGlobalConcurrency } from '@/lib/task/image-queue-concurrency'

describe('image queue global concurrency', () => {
  it('defaults to 10', () => {
    expect(readImageQueueGlobalConcurrency(undefined)).toBe(10)
  })

  it.each(['0', '-1', 'abc'])('falls back to 10 for invalid value %s', (raw) => {
    expect(readImageQueueGlobalConcurrency(raw)).toBe(10)
  })

  it('accepts a positive integer', () => {
    expect(readImageQueueGlobalConcurrency('7')).toBe(7)
  })
})
