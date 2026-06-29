import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { CODEX_PROVIDER_KEY } from './constants'
import { executeCodexImageGeneration } from './image'
import { createCodexLanguageModel, runCodexLlmCompletion, runCodexLlmStream, runCodexVisionCompletion } from './llm'
import { resolveCodexOptionSchema } from './models'

function describeCodexMediaVariant(
  selection: Parameters<NonNullable<AiProviderAdapter['image']>['describe']>[0],
) {
  return describeMediaVariantBase({
    modality: 'image',
    selection,
    executionMode: 'sync',
    optionSchema: resolveCodexOptionSchema('image'),
  })
}

export const codexAdapter: AiProviderAdapter = {
  providerKey: CODEX_PROVIDER_KEY,
  image: {
    describe: describeCodexMediaVariant,
    execute: executeCodexImageGeneration,
  },
  completeLlm: (input) => runCodexLlmCompletion({
    providerConfig: input.providerConfig,
    modelId: input.selection.modelId,
    messages: input.messages,
  }),
  languageModel: {
    create: createCodexLanguageModel,
  },
  streamLlm: runCodexLlmStream,
  completeVision: runCodexVisionCompletion,
}
