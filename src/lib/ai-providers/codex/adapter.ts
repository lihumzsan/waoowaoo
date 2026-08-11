import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { buildMediaOptionSchema } from '@/lib/ai-providers/shared/option-schema'
import { createCodexLanguageModel } from './language-model'
import { prepareCodexImageGeneration } from './image'

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
  image: {
    describe: describeImage,
    prepare: prepareCodexImageGeneration,
  },
  languageModel: {
    create: createCodexLanguageModel,
  },
}
