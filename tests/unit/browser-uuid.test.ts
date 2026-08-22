import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserUuid } from '@/lib/browser-uuid'

describe('browser UUID generation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a UUID v4 when an HTTP context omits crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (!(array instanceof Uint8Array)) throw new TypeError('Uint8Array required')
        array.set(Array.from({ length: 16 }, (_, index) => index))
        return array
      },
    })

    expect(createBrowserUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})
