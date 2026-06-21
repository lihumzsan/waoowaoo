import type { LanguageModel } from 'ai'
import type {
  AiLlmExecutionInput,
  AiLlmExecutionResult,
  AiResolvedSelection,
  AiVariantDescriptor,
  AiLlmProviderConfig,
} from '@/lib/ai-registry/types'
import type { ProviderChatCompletionOptions, ProviderChatCompletionStreamCallbacks } from '@/lib/ai-providers/shared/llm-support'

export type GenerateResult = {
  success: boolean
  imageUrl?: string
  imageUrls?: string[]
  imageBase64?: string
  videoUrl?: string
  audioUrl?: string
  audioBase64?: string
  audioMimeType?: string
  metadata?: Record<string, unknown>
  error?: string
  requestId?: string
  async?: boolean
  endpoint?: string
  externalId?: string
}

export type AiProviderLlmResult = Pick<
  AiLlmExecutionResult,
  'completion' | 'logProvider' | 'text' | 'reasoning' | 'usage' | 'successDetails'
>

export type AiProviderLlmStreamContext = {
  userId: string
  selection: {
    provider: string
    modelId: string
    modelKey: string
    variantData?: { [key: string]: unknown }
  }
  providerConfig: AiLlmProviderConfig
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  options: ProviderChatCompletionOptions
  callbacks?: ProviderChatCompletionStreamCallbacks
}

export type AiProviderVisionExecutionContext = {
  userId: string
  providerKey: string
  selection: AiLlmExecutionInput['selection']
  providerConfig: AiLlmExecutionInput['providerConfig']
  textPrompt: string
  imageUrls: string[]
  temperature: number
  reasoning: boolean
  options?: ProviderChatCompletionOptions
}

export type AiProviderLanguageModelContext = {
  providerKey: string
  selection: {
    provider: string
    modelId: string
    modelKey: string
  }
  providerConfig: AiLlmProviderConfig
  openRouterSessionId?: string
}

export type AiProviderImageExecutionContext = {
  userId: string
  selection: AiResolvedSelection & {
    provider: string
    modelId: string
    modelKey: string
  }
  prompt: string
  options?: {
    referenceImages?: string[]
    aspectRatio?: string
    resolution?: string
    outputFormat?: string
    keepOriginalAspectRatio?: boolean
    size?: string
    quality?: string
    responseFormat?: string
    background?: string
    outputCompression?: number
    moderation?: string
    [key: string]: unknown
  }
}

export type AiProviderVideoExecutionContext = {
  userId: string
  selection: AiResolvedSelection & {
    provider: string
    modelId: string
    modelKey: string
  }
  imageUrl: string
  options?: {
    prompt?: string
    duration?: number
    fps?: number
    resolution?: string
    aspectRatio?: string
    generateAudio?: boolean
    lastFrameImageUrl?: string
    referenceImages?: string[]
    [key: string]: unknown
  }
}

export type AiProviderMusicExecutionContext = {
  userId: string
  selection: AiResolvedSelection & {
    provider: string
    modelId: string
    modelKey: string
  }
  prompt: string
  options?: {
    durationSeconds?: number
    vocalMode?: 'instrumental' | 'vocal'
    genre?: string
    mood?: string
    bpm?: number
    outputFormat?: 'mp3' | 'wav'
    [key: string]: unknown
  }
}

export type AiProviderMediaModalityAdapter<M extends 'image' | 'video' | 'music'> = {
  describe: (selection: AiResolvedSelection) => AiVariantDescriptor
  execute: (
    input: M extends 'image'
      ? AiProviderImageExecutionContext
      : M extends 'video'
        ? AiProviderVideoExecutionContext
        : AiProviderMusicExecutionContext,
  ) => Promise<GenerateResult>
}

export type AiProviderLanguageModelAdapter = {
  create: (input: AiProviderLanguageModelContext) => LanguageModel
}

export interface AiProviderAdapter {
  readonly providerKey: string
  image?: AiProviderMediaModalityAdapter<'image'>
  video?: AiProviderMediaModalityAdapter<'video'>
  music?: AiProviderMediaModalityAdapter<'music'>
  languageModel?: AiProviderLanguageModelAdapter
  completeLlm?: (input: AiLlmExecutionInput) => Promise<AiProviderLlmResult>
  streamLlm?: (input: AiProviderLlmStreamContext) => Promise<AiProviderLlmResult>
  completeVision?: (input: AiProviderVisionExecutionContext) => Promise<AiProviderLlmResult>
}
