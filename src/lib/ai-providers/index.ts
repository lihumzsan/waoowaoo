import { AiRegistry } from '@/lib/ai-registry/registry'
import type {
  AsyncExternalIdProvider,
  AsyncTaskProviderRegistration,
} from '@/lib/ai-providers/async-task-types'
import { arkAdapter } from '@/lib/ai-providers/ark/adapter'
import { arkAsyncTaskProvider } from '@/lib/ai-providers/ark/async-task'
import { arkSeedance2VideoTokenPricingContract } from '@/lib/ai-providers/ark/video-token-pricing'
import { falAdapter } from '@/lib/ai-providers/fal/adapter'
import { falAsyncTaskProvider } from '@/lib/ai-providers/fal/async-task'
import { googleAdapter } from '@/lib/ai-providers/google/adapter'
import { geminiBatchAsyncTaskProvider, googleVideoAsyncTaskProvider } from '@/lib/ai-providers/google/async-task'
import { elevenLabsAdapter } from '@/lib/ai-providers/elevenlabs/adapter'
import { openRouterAdapter } from '@/lib/ai-providers/openrouter/adapter'
import { openRouterAsyncTaskProvider } from '@/lib/ai-providers/openrouter/async-task'
import type { AiProviderAdapter, AiProviderLanguageModelContext } from '@/lib/ai-providers/runtime-types'
import type { VideoTokenPricingContract } from '@/lib/ai-providers/shared/video-token-pricing'

const runtimeProviderRegistry = new AiRegistry<AiProviderAdapter>([
  arkAdapter,
  falAdapter,
  googleAdapter,
  elevenLabsAdapter,
  openRouterAdapter,
])

const asyncTaskProviderRegistry: AsyncTaskProviderRegistration[] = [
  falAsyncTaskProvider,
  arkAsyncTaskProvider,
  geminiBatchAsyncTaskProvider,
  googleVideoAsyncTaskProvider,
  openRouterAsyncTaskProvider,
]

const videoTokenPricingContracts: VideoTokenPricingContract[] = [
  arkSeedance2VideoTokenPricingContract,
]

export function resolveAsyncTaskProviderByExternalId(externalId: string): AsyncTaskProviderRegistration {
  const registration = asyncTaskProviderRegistry.find((candidate) => candidate.canParseExternalId(externalId))
  if (!registration) {
    throw new Error(
      `无法识别的 externalId 格式: "${externalId}". ` +
      `支持的格式: FAL:TYPE:endpoint:requestId, ARK:TYPE:requestId, GEMINI:BATCH:batchName, GOOGLE:VIDEO:operationName, OPENROUTER:VIDEO:requestId`,
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

export function resolveVideoTokenPricingContract(model: string): VideoTokenPricingContract | null {
  return videoTokenPricingContracts.find((contract) => contract.supportsModel(model)) ?? null
}

export function resolveAiProviderAdapter(providerId: string): AiProviderAdapter {
  return runtimeProviderRegistry.getAdapterByProviderId(providerId)
}

export function tryResolveAiProviderAdapter(providerId: string): AiProviderAdapter | null {
  return runtimeProviderRegistry.tryGetAdapterByProviderId(providerId)
}

export function createRegisteredLanguageModel(input: AiProviderLanguageModelContext) {
  const languageModelProvider = resolveAiProviderAdapter(input.selection.provider).languageModel
  if (!languageModelProvider) {
    throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${input.selection.provider}:languageModel`)
  }
  return languageModelProvider.create(input)
}
