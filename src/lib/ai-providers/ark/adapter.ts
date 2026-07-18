import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { createArkLanguageModel, prepareArkTextModelMessages } from './language-model'
import { arkConnectionTester } from './connection-test'
import { executeArkImageGeneration } from './image'
import { resolveArkOptionSchema } from './models'
import { executeArkVideoGeneration } from './video'

function describeArkMediaVariant(
  modality: 'image' | 'video',
  selection: Parameters<NonNullable<AiProviderAdapter['image']>['describe']>[0],
) {
  const executionMode = modality === 'video'
    ? (selection.modelId.endsWith('-batch') ? 'batch' : 'async')
    : 'sync'
  return describeMediaVariantBase({
    modality,
    selection,
    executionMode,
    optionSchema: resolveArkOptionSchema(modality, selection.modelId),
  })
}

export const arkAdapter: AiProviderAdapter = {
  providerKey: 'ark',
  image: {
    describe: (selection) => describeArkMediaVariant('image', selection),
    execute: executeArkImageGeneration,
  },
  video: {
    describe: (selection) => describeArkMediaVariant('video', selection),
    execute: executeArkVideoGeneration,
  },
  languageModel: {
    create: createArkLanguageModel,
    prepareTextMessages: prepareArkTextModelMessages,
  },
  connectionTest: arkConnectionTester,
}
