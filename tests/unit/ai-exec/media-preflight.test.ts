import { describe, expect, it } from 'vitest'
import {
  normalizeMediaOptionsForSelection,
} from '@/lib/ai-exec/media-preflight'
import { AiOptionValidationError } from '@/lib/ai-exec/normalize'

const MUREKA_SELECTION = {
  provider: 'mureka',
  modelId: 'mureka-9',
  modelKey: 'mureka::mureka-9',
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

})
