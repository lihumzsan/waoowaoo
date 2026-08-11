import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { AiOptionValidationError } from '@/lib/ai-exec/normalize'

const ELEVENLABS_SELECTION = {
  provider: 'elevenlabs',
  modelId: 'music_v2',
  modelKey: 'elevenlabs::music_v2',
  variantSubKind: 'official',
} as const

describe('media generation preflight', () => {
  it('requires the selected music model to declare Composition Plan generation', () => {
    ensureAiCatalogsRegistered()
    expect(normalizeMediaOptionsForSelection({
      selection: ELEVENLABS_SELECTION,
      modality: 'music',
      musicGenerationMode: 'composition_plan',
      options: { outputFormat: 'mp3' },
    })).toEqual({ outputFormat: 'mp3' })

    expect(() => normalizeMediaOptionsForSelection({
      selection: ELEVENLABS_SELECTION,
      modality: 'music',
      musicGenerationMode: 'prompt',
      prompt: 'legacy prompt',
      options: { outputFormat: 'mp3' },
    })).toThrow(AiOptionValidationError)
  })
})
