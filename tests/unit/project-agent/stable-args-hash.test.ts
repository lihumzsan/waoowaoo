import { describe, expect, it } from 'vitest'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'

describe('project agent stable operation-input identity', () => {
  it('hashes equivalent object values identically regardless of key order', () => {
    expect(stableArgsHash({ b: 2, a: 1 })).toBe(stableArgsHash({ a: 1, b: 2 }))
  })

  it('trims strings and omits undefined object fields', () => {
    expect(stableArgsHash({
      prompt: ' make it cinematic ',
      optional: undefined,
    })).toBe(stableArgsHash({
      prompt: 'make it cinematic',
    }))
  })
})
