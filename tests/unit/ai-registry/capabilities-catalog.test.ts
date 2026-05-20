import { describe, expect, it } from 'vitest'
import { resolveGenerationOptionsForModel } from '@/lib/ai-registry/capabilities-catalog'

const imageCapabilities = {
  image: {
    resolutionOptions: ['1K', '2K', '4K'],
    qualityOptions: ['high', 'medium', 'low'],
  },
}

describe('ai-registry/capabilities-catalog', () => {
  it('defaults image resolution to 1K when no selection is saved', () => {
    const resolved = resolveGenerationOptionsForModel({
      modelType: 'image',
      modelKey: 'gemini-compatible:provider::gemini-3-pro-image-preview',
      capabilities: imageCapabilities,
      requireAllFields: true,
    })

    expect(resolved.issues).toEqual([])
    expect(resolved.options).toEqual({ resolution: '1K', quality: 'high' })
  })

  it('keeps explicit image resolution and quality selections', () => {
    const resolved = resolveGenerationOptionsForModel({
      modelType: 'image',
      modelKey: 'gemini-compatible:provider::gemini-3-pro-image-preview',
      capabilities: imageCapabilities,
      capabilityOverrides: {
        'gemini-compatible:provider::gemini-3-pro-image-preview': {
          resolution: '4K',
          quality: 'medium',
        },
      },
      requireAllFields: true,
    })

    expect(resolved.issues).toEqual([])
    expect(resolved.options).toEqual({ resolution: '4K', quality: 'medium' })
  })

  it('rejects image resolution selections unsupported by the model', () => {
    const resolved = resolveGenerationOptionsForModel({
      modelType: 'image',
      modelKey: 'gemini-compatible:provider::gemini-3-pro-image-preview',
      capabilities: imageCapabilities,
      capabilityOverrides: {
        'gemini-compatible:provider::gemini-3-pro-image-preview': {
          resolution: '0.5K',
        },
      },
      requireAllFields: true,
    })

    expect(resolved.options).toEqual({})
    expect(resolved.issues).toEqual([
      expect.objectContaining({
        code: 'CAPABILITY_VALUE_NOT_ALLOWED',
        field: 'capabilities.gemini-compatible:provider::gemini-3-pro-image-preview.resolution',
      }),
    ])
  })

  it('rejects image quality selections unsupported by the model', () => {
    const resolved = resolveGenerationOptionsForModel({
      modelType: 'image',
      modelKey: 'fal::gpt-image-2',
      capabilities: imageCapabilities,
      capabilityOverrides: {
        'fal::gpt-image-2': {
          quality: 'standard',
        },
      },
      requireAllFields: true,
    })

    expect(resolved.options).toEqual({})
    expect(resolved.issues).toEqual([
      expect.objectContaining({
        code: 'CAPABILITY_VALUE_NOT_ALLOWED',
        field: 'capabilities.fal::gpt-image-2.quality',
      }),
    ])
  })
})
