import { AiRegistry } from '@/lib/ai-registry/registry'
import type {
  AsyncExternalIdProvider,
  AsyncTaskProviderRegistration,
} from '@/lib/ai-providers/async-task-types'
import { arkAdapter } from '@/lib/ai-providers/ark/adapter'
import { arkAsyncTaskProvider } from '@/lib/ai-providers/ark/async-task'
import { falAdapter } from '@/lib/ai-providers/fal/adapter'
import { falAsyncTaskProvider } from '@/lib/ai-providers/fal/async-task'
import { googleAdapter } from '@/lib/ai-providers/google/adapter'
import { geminiBatchAsyncTaskProvider, googleVideoAsyncTaskProvider } from '@/lib/ai-providers/google/async-task'
import { murekaAdapter } from '@/lib/ai-providers/mureka/adapter'
import { murekaAsyncTaskProvider } from '@/lib/ai-providers/mureka/async-task'
import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
import { openRouterAsyncTaskProvider } from '@/lib/ai-providers/openrouter/async-task'
import { toonflowAdapter } from '@/lib/ai-providers/toonflow/adapter'
import { toonflowAsyncTaskProvider } from '@/lib/ai-providers/toonflow/async-task'
import type { AiProviderAdapter, AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import type {
  AiProviderLanguageModelRequestContext,
  AiProviderLanguageModelValidationContext,
} from '@/lib/ai-providers/runtime-types'
import type { AiLlmExecutionResult, AiLlmMessage } from '@/lib/ai-registry/types'
import type { ModelMessage } from 'ai'
import { flattenChatMessageContent } from '@/lib/ai-registry/message-content'
import {
  resolveRegisteredLlmProtocol,
  resolveRegisteredPublicReasoningMode,
} from '@/lib/ai-registry/llm-protocol'

const runtimeProviderRegistry = new AiRegistry<AiProviderAdapter>([
  arkAdapter,
  falAdapter,
  googleAdapter,
  murekaAdapter,
  openRouterAdapter,
  toonflowAdapter,
])

const asyncTaskProviderRegistry: AsyncTaskProviderRegistration[] = [
  falAsyncTaskProvider,
  arkAsyncTaskProvider,
  geminiBatchAsyncTaskProvider,
  googleVideoAsyncTaskProvider,
  murekaAsyncTaskProvider,
  openRouterAsyncTaskProvider,
  toonflowAsyncTaskProvider,
]

export function resolveAsyncTaskProviderByExternalId(externalId: string): AsyncTaskProviderRegistration {
  const registration = asyncTaskProviderRegistry.find((candidate) => candidate.canParseExternalId(externalId))
  if (!registration) {
    throw new Error(
      `无法识别的 externalId 格式: "${externalId}". ` +
      `支持的格式: FAL:TYPE:endpoint:requestId, ARK:TYPE:requestId, GEMINI:BATCH:batchName, GOOGLE:VIDEO:operationName, OPENROUTER:VIDEO:requestId, TOONFLOW:VIDEO:taskICode, MUREKA:MUSIC:endpoint:taskId`,
    )
  }
  return registration
}

export function resolveAsyncTaskProviderByCode(providerCode: AsyncExternalIdProvider): AsyncTaskProviderRegistration {
  const registration = asyncTaskProviderRegistry.find((candidate) => candidate.providerCode === providerCode)
  if (!registration) {
    throw new Error(`未知的 Provider: ${providerCode}`)
  }
  return registration
}

export function resolveAiProviderAdapter(providerId: string): AiProviderAdapter {
  return runtimeProviderRegistry.getAdapterByProviderId(providerId)
}

export function tryResolveAiProviderAdapter(providerId: string): AiProviderAdapter | null {
  return runtimeProviderRegistry.tryGetAdapterByProviderId(providerId)
}

export function createRegisteredLanguageModel(input: AiProviderLanguageModelRequestContext) {
  const languageModelProvider = resolveAiProviderAdapter(input.selection.provider).languageModel
  if (!languageModelProvider) {
    throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${input.selection.provider}:languageModel`)
  }
  const context: AiProviderLanguageModelContext = {
    ...input,
    protocol: resolveRegisteredLlmProtocol(input.selection.modelKey),
    publicReasoningMode: resolveRegisteredPublicReasoningMode(input.selection.modelKey),
  }
  return languageModelProvider.create(context)
}

function defaultTextModelMessages(messages: AiLlmMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: flattenChatMessageContent(message.content),
  }))
}

export function prepareRegisteredTextModelMessages(
  providerId: string,
  messages: AiLlmMessage[],
): ModelMessage[] {
  const languageModelProvider = resolveAiProviderAdapter(providerId).languageModel
  if (!languageModelProvider) {
    throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${providerId}:languageModel`)
  }
  return languageModelProvider.prepareTextMessages?.(messages) ?? defaultTextModelMessages(messages)
}

export function validateRegisteredLanguageModelResult(
  providerId: string,
  result: AiLlmExecutionResult,
  context: AiProviderLanguageModelValidationContext,
): void {
  const languageModelProvider = resolveAiProviderAdapter(providerId).languageModel
  if (!languageModelProvider) {
    throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${providerId}:languageModel`)
  }
  languageModelProvider.validateResult?.(result, context)
}
