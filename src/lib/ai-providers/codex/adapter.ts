import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildMediaOptionSchema } from '@/lib/ai-providers/shared/option-schema'
import { prepareCodexImageGeneration } from './image'
import { createAiProviderFailureAdapter } from '@/lib/ai-providers/failure'

function describeImage(selection: Parameters<NonNullable<AiProviderAdapter['image']>['describe']>[0]) {
  return describeMediaVariantBase({
    modality: 'image',
    selection,
    executionMode: 'sync',
    optionSchema: buildMediaOptionSchema('image'),
  })
}

export const codexAdapter: AiProviderAdapter = {
  providerKey: 'codex',
  failure: createAiProviderFailureAdapter('codex'),
  image: {
    describe: describeImage,
    prepare: prepareCodexImageGeneration,
  },
}
