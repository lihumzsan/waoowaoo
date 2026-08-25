import { describe, expect, it } from 'vitest'
import { validateModelCapabilities } from '@/lib/ai-registry/types'

describe('video prompt profile validator conformance', () => {
  it.each([
    ['missing capabilities', undefined],
    ['missing video namespace', {}],
  ])('rejects %s', (_label, capabilities) => {
    expect(validateModelCapabilities('video', capabilities)).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_NAMESPACE_INVALID',
      field: 'capabilities.video',
    }))
  })

  it('rejects a missing prompt profile inside the video namespace', () => {
    expect(validateModelCapabilities('video', { video: {} })).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_VALUE_NOT_ALLOWED',
      field: 'capabilities.video.promptProfile',
    }))
  })

  it('rejects an unknown prompt profile', () => {
    expect(validateModelCapabilities('video', {
      video: { promptProfile: 'unknown_v1' },
    })).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_VALUE_NOT_ALLOWED',
      field: 'capabilities.video.promptProfile',
    }))
  })

  it.each(['generic_v1', 'minimax_h3_multimodal_v3'] as const)(
    'accepts the legal %s profile',
    (promptProfile) => {
      expect(validateModelCapabilities('video', { video: { promptProfile } })).toEqual([])
    },
  )
})
