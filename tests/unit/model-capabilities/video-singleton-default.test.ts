import { describe, expect, it } from 'vitest'
import type { CapabilitySelections, ModelCapabilities } from '@/lib/model-config-contract'
import { resolveGenerationOptionsForModel } from '@/lib/model-capabilities/lookup'
import {
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
} from '@/lib/model-capabilities/video-effective'

describe('model-capabilities/lookup - video singleton defaults', () => {
  const modelKey = 'comfyui::basevideo/seedance2/bernini-480p-i2v'
  const capabilities: ModelCapabilities = {
    video: {
      generationModeOptions: ['normal'],
      durationOptions: [5, 10],
      fpsOptions: [24],
      resolutionOptions: ['480p'],
      motionStrengthOptions: [1, 2, 3],
    },
  }

  it('auto-fills missing singleton video fields while preserving configured choices', () => {
    const capabilityOverrides: CapabilitySelections = {
      [modelKey]: {
        generationMode: 'normal',
        duration: 10,
        resolution: '480p',
        motionStrength: 2,
      },
    }

    const result = resolveGenerationOptionsForModel({
      modelType: 'video',
      modelKey,
      capabilities,
      capabilityOverrides,
      requireAllFields: true,
    })

    expect(result.issues).toEqual([])
    expect(result.options).toEqual({
      generationMode: 'normal',
      duration: 10,
      fps: 24,
      resolution: '480p',
      motionStrength: 2,
    })
  })

  it('uses the first motion strength option as the UI default', () => {
    const definitions = resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: capabilities.video,
    })
    const result = normalizeVideoGenerationSelections({ definitions })

    expect(result.motionStrength).toBe(1)
  })
})
