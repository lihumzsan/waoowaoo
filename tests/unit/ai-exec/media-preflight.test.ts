import { describe, expect, it } from 'vitest'
import {
  normalizeMediaOptionsForSelection,
  preflightMediaProviderRoutes,
} from '@/lib/ai-exec/media-preflight'
import { AiOptionValidationError } from '@/lib/ai-exec/normalize'

const MUREKA_SELECTION = {
  provider: 'mureka',
  modelId: 'mureka-9',
  modelKey: 'mureka::mureka-9',
  variantSubKind: 'official',
} as const

const OPENROUTER_GPT_IMAGE_2_SELECTION = {
  provider: 'openrouter',
  modelId: 'openai/gpt-image-2',
  modelKey: 'openrouter::openai/gpt-image-2',
  variantSubKind: 'official',
} as const

describe('media generation preflight', () => {
  it('checks the final compiled music prompt before provider execution', () => {
    const options = {
      durationSeconds: 60,
      vocalMode: 'instrumental',
      genre: 'industrial ambient',
      mood: 'restrained',
      bpm: 72,
      outputFormat: 'mp3',
    }
    expect(normalizeMediaOptionsForSelection({
      selection: MUREKA_SELECTION,
      modality: 'music',
      prompt: 'A low-frequency pulse with sparse bowed metal.',
      options,
    })).toMatchObject(options)

    try {
      normalizeMediaOptionsForSelection({
        selection: MUREKA_SELECTION,
        modality: 'music',
        prompt: 'x'.repeat(980),
        options,
      })
      throw new Error('Expected the compiled provider prompt to exceed its limit')
    } catch (error) {
      expect(error).toBeInstanceOf(AiOptionValidationError)
      expect(error).toMatchObject({
        failure: 'invalid_option',
        field: 'prompt',
        reason: 'max_chars_1024',
      })
    }
  })

  it('checks the frozen Worker options against every declared pre-accept route', () => {
    expect(() => preflightMediaProviderRoutes({
      selection: OPENROUTER_GPT_IMAGE_2_SELECTION,
      modality: 'image',
      options: {
        aspectRatio: '4:3',
        resolution: '1K',
        quality: 'high',
        outputFormat: 'png',
        referenceImages: [],
      },
    })).not.toThrow()

    expect(() => preflightMediaProviderRoutes({
      selection: OPENROUTER_GPT_IMAGE_2_SELECTION,
      modality: 'image',
      options: {
        aspectRatio: '4:3',
        resolution: '1K',
        quality: 'high',
        outputFormat: 'png',
        referenceImages: [],
        moderation: 'low',
      },
    })).toThrow('image:fal::gpt-image-2:moderation')
  })
})
