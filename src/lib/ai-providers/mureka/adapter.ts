import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { executeMurekaMusicGeneration } from './music'
import { resolveMurekaOptionSchema } from './models'

export const murekaAdapter: AiProviderAdapter = {
  providerKey: 'mureka',
  failure: createAiProviderFailureAdapter('mureka'),
  music: {
    describe: (selection) => describeMediaVariantBase({
      modality: 'music',
      selection,
      executionMode: 'async',
      optionSchema: resolveMurekaOptionSchema('music', selection.modelId),
    }),
    execute: executeMurekaMusicGeneration,
  },
}
