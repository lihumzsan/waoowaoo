import { describe, expect, it } from 'vitest'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { normalizeMediaOptionsForSelection } from '@/lib/ai-exec/media-preflight'
import { AiOptionValidationError } from '@/lib/ai-exec/normalize'

const ACE_STEP_SELECTION = {
  provider: 'comfyui',
  modelId: 'ace-step-1.5',
  modelKey: 'comfyui::ace-step-1.5',
  variantSubKind: 'official',
} as const

describe('media generation preflight', () => {
  it('requires the selected music model to declare its requested generation mode', () => {
    ensureAiCatalogsRegistered()
    expect(normalizeMediaOptionsForSelection({
      selection: ACE_STEP_SELECTION,
      modality: 'music',
      musicGenerationMode: 'prompt',
      options: { durationSeconds: 30, vocalMode: 'instrumental', bpm: 72, keyScale: 'D minor', timeSignature: '4', outputFormat: 'mp3' },
    })).toEqual({ durationSeconds: 30, vocalMode: 'instrumental', bpm: 72, keyScale: 'D minor', timeSignature: '4', outputFormat: 'mp3', providerDurationSeconds: 30 })

    expect(() => normalizeMediaOptionsForSelection({
      selection: ACE_STEP_SELECTION,
      modality: 'music',
      musicGenerationMode: 'composition_plan',
      prompt: 'legacy prompt',
      options: { durationSeconds: 30, vocalMode: 'instrumental', bpm: 72, keyScale: 'D minor', timeSignature: '4', outputFormat: 'mp3' },
    })).toThrow(AiOptionValidationError)
  })
})
