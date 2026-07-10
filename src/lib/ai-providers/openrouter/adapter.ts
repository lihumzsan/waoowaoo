import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { openRouterConnectionTester } from './connection-test'
import { createOpenRouterLanguageModel } from './language-model'
import { resolveOpenRouterOptionSchema } from './models'
import { buildOpenRouterSessionId, normalizeOpenRouterSessionId } from './session'
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
    openRouterSessionId: input.openRouterSessionId,
  }),
  languageModel: {
    create: createOpenRouterLanguageModel,
  },
  connectionTest: openRouterConnectionTester,
  resolveLlmSessionId: (input) => normalizeOpenRouterSessionId(input.explicitSessionId)
    ?? buildOpenRouterSessionId({
      kind: input.kind,
      userId: input.userId,
      projectId: input.projectId,
      action: input.action,
      modelKey: input.modelKey,
    }),
  completeVision: runOpenRouterVisionCompletion,
  streamLlm: runOpenRouterLlmStream,
  video: {
    describe: (selection) => describeOpenRouterMediaVariant('video', selection),
    execute: executeOpenRouterVideoGeneration,
  },
}
