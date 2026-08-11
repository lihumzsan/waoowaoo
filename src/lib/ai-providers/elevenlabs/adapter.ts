import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { elevenLabsConnectionTester, elevenLabsFailureAdapter } from './connection-test'
import { executeElevenLabsMusicGeneration } from './music'
import { resolveElevenLabsOptionSchema } from './models'

export const elevenLabsAdapter: AiProviderAdapter = {
  providerKey: 'elevenlabs',
  failure: elevenLabsFailureAdapter,
  music: {
    describe: (selection) => describeMediaVariantBase({
      modality: 'music',
      selection,
      executionMode: 'sync',
      optionSchema: resolveElevenLabsOptionSchema('music', selection.modelId),
    }),
    execute: executeElevenLabsMusicGeneration,
  },
  connectionTest: elevenLabsConnectionTester,
}
