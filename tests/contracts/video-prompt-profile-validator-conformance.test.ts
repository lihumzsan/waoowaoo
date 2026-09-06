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

  it('requires an explicit source contract when continuation is supported', () => {
    expect(validateModelCapabilities('video', {
      video: {
        promptProfile: 'minimax_h3_multimodal_v3',
        supportedInputModes: ['continuation'],
        supportedAspectRatios: ['16:9'],
        inputModePolicies: { continuation: { durationOptions: [4] } },
      },
    })).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.continuationInput',
    }))

    expect(validateModelCapabilities('video', {
      video: {
        promptProfile: 'minimax_h3_multimodal_v3',
        supportedInputModes: ['continuation'],
        supportedAspectRatios: ['16:9'],
        inputModePolicies: { continuation: { durationOptions: [4, 5] } },
        continuationInput: {
          minSourceDurationMs: 917,
          maxSourceDurationMs: 13_041,
          sourceAspectRatiosByTarget: {
            '16:9': [{ width: 2064, height: 1152 }],
          },
        },
      },
    })).toEqual([])

    expect(validateModelCapabilities('video', {
      video: {
        promptProfile: 'minimax_h3_multimodal_v3',
        supportedInputModes: ['continuation'],
        supportedAspectRatios: ['16:9'],
        inputModePolicies: { continuation: { durationOptions: [4, 5] } },
        continuationInput: {
          minSourceDurationMs: 917,
          maxSourceDurationMs: 13_041,
          sourceAspectRatiosByTarget: {
            '9:16': [{ width: 1152, height: 2064 }],
          },
        },
      },
    })).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.continuationInput.sourceAspectRatiosByTarget.16:9',
    }))
  })

  it('requires one duration policy per supported mode and an explicit ratio set', () => {
    expect(validateModelCapabilities('video', {
      video: {
        promptProfile: 'generic_v1',
        supportedInputModes: ['reference'],
        inputModePolicies: { reference: { durationOptions: [5] } },
      },
    })).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.supportedAspectRatios',
    }))

    expect(validateModelCapabilities('video', {
      video: {
        promptProfile: 'generic_v1',
        supportedInputModes: ['reference', 'first_frame'],
        supportedAspectRatios: ['16:9'],
        inputModePolicies: { reference: { durationOptions: [5] } },
      },
    })).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_FIELD_INVALID',
      field: 'capabilities.video.inputModePolicies.first_frame',
    }))

    expect(validateModelCapabilities('video', {
      video: {
        promptProfile: 'generic_v1',
        supportedInputModes: ['reference'],
        supportedAspectRatios: [],
        inputModePolicies: { reference: { durationOptions: [] } },
      },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'capabilities.video.supportedAspectRatios' }),
      expect.objectContaining({ field: 'capabilities.video.inputModePolicies.reference.durationOptions' }),
    ]))
  })
})
