import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { createOpenAiSdkLanguageModel } from '@/lib/ai-providers/shared/language-model'
import { resolveOpenRouterOptionSchema } from './models'
import { runOpenRouterLlmCompletion, runOpenRouterLlmStream, runOpenRouterVisionCompletion } from './llm'
import { executeOpenRouterVideoGeneration } from './video'

function describeOpenRouterMediaVariant(
  modality: 'video',
  selection: Parameters<NonNullable<AiProviderAdapter['video']>['describe']>[0],
) {
  return describeMediaVariantBase({
    modality,
    selection,
    executionMode: 'async',
    optionSchema: resolveOpenRouterOptionSchema(modality, selection.modelId),
  })
}

export const openRouterAdapter: AiProviderAdapter = {
  providerKey: 'openrouter',
  completeLlm: (input) => runOpenRouterLlmCompletion({
    modelId: input.selection.modelId,
    providerConfig: input.providerConfig,
    messages: input.messages,
    temperature: input.temperature,
    reasoning: input.reasoning,
    reasoningEffort: input.reasoningEffort,
    maxRetries: input.maxRetries,
  }),
  languageModel: {
    create: createOpenAiSdkLanguageModel,
  },
  completeVision: runOpenRouterVisionCompletion,
  streamLlm: runOpenRouterLlmStream,
  video: {
    describe: (selection) => describeOpenRouterMediaVariant('video', selection),
    execute: executeOpenRouterVideoGeneration,
  },
}
