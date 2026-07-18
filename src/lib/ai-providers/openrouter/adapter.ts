import type { AiProviderAdapter } from '@/lib/ai-providers/runtime-types'
import { describeMediaVariantBase } from '@/lib/ai-providers/shared/media-adapter'
import { openRouterConnectionTester } from './connection-test'
import {
  createOpenRouterLanguageModel,
  validateOpenRouterLanguageModelResult,
} from './language-model'
import { resolveOpenRouterOptionSchema } from './models'
import { buildOpenRouterSessionId, normalizeOpenRouterSessionId } from './session'
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
  languageModel: {
    create: createOpenRouterLanguageModel,
    validateResult: validateOpenRouterLanguageModelResult,
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
  video: {
    describe: (selection) => describeOpenRouterMediaVariant('video', selection),
    execute: executeOpenRouterVideoGeneration,
  },
}
