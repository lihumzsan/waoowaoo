import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { executeToonflowVideoGeneration } from './video'
import { resolveToonflowOptionSchema } from './models'

export const toonflowAdapter: AiProviderAdapter = {
  providerKey: 'toonflow',
  failure: createAiProviderFailureAdapter('toonflow'),
  video: {
    describe: (selection) => describeMediaVariantBase({
      modality: 'video',
      selection,
      executionMode: 'async',
      optionSchema: resolveToonflowOptionSchema('video', selection.modelId),
    }),
    execute: executeToonflowVideoGeneration,
  },
}
