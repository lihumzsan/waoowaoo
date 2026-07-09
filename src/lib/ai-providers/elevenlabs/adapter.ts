import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import {
  booleanValidator,
  buildMediaOptionSchema,
  enumValidator,
  nonEmptyStringValidator,
} from '@/lib/ai-providers/shared/option-schema'
import { executeElevenLabsSoundEffectGeneration } from './sound-effect'

function numberRangeValidator(input: { min: number; max: number }) {
  return (value: unknown) => {
    if (value === undefined) return { ok: true as const }
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false as const, reason: 'expected_number' }
    if (value < input.min) return { ok: false as const, reason: `min=${input.min}` }
    if (value > input.max) return { ok: false as const, reason: `max=${input.max}` }
    return { ok: true as const }
  }
}

function describeElevenLabsSoundEffectVariant(
  selection: Parameters<NonNullable<AiProviderAdapter['soundEffect']>['describe']>[0],
) {
  return describeMediaVariantBase({
    modality: 'soundEffect',
    selection,
    executionMode: 'sync',
    optionSchema: buildMediaOptionSchema('soundEffect', {
      validators: {
        durationSeconds: numberRangeValidator({ min: 0.5, max: 30 }),
        loop: booleanValidator(),
        promptInfluence: numberRangeValidator({ min: 0, max: 1 }),
        outputFormat: enumValidator(['mp3_44100_128', 'mp3_44100_192']),
        modelId: nonEmptyStringValidator(),
        modelKey: nonEmptyStringValidator(),
        provider: nonEmptyStringValidator(),
      },
    }),
  })
}

export const elevenLabsAdapter: AiProviderAdapter = {
  providerKey: 'elevenlabs',
  soundEffect: {
    describe: describeElevenLabsSoundEffectVariant,
    execute: executeElevenLabsSoundEffectGeneration,
  },
}
