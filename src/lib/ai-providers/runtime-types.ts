import type { LanguageModel } from 'ai'
import type {
  AiLlmExecutionInput,
  AiLlmExecutionResult,
  AiResolvedSelection,
  AiVariantDescriptor,
  AiLlmProviderConfig,
} from '@/lib/ai-registry/types'
import type {
  ProviderChatCompletionOptions,
  ProviderChatCompletionStreamCallbacks,
  ProviderChatMessage,
} from '@/lib/ai-providers/shared/llm-support'
import type { ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'

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
  'completion' | 'logProvider' | 'text' | 'reasoning' | 'termination' | 'usage' | 'successDetails'
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
  messages: ProviderChatMessage[]
  options: ProviderChatCompletionOptions & { reasoningEffort: ReasoningEffort }
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
  reasoningEffort: ReasoningEffort
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
  reasoningEffort: ReasoningEffort
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
    negativePrompt?: string
    durationSeconds?: number
    vocalMode?: 'instrumental' | 'vocal'
    genre?: string
    mood?: string
    bpm?: number
    outputFormat?: 'mp3' | 'wav'
    [key: string]: unknown
  }
}

export type AiProviderSoundEffectExecutionContext = {
  userId: string
  selection: AiResolvedSelection & {
    provider: string
    modelId: string
    modelKey: string
  }
  prompt: string
  options?: {
    durationSeconds?: number
    loop?: boolean
    promptInfluence?: number
    outputFormat?: string
    [key: string]: unknown
  }
}

export type AiProviderMediaModalityAdapter<M extends 'image' | 'video' | 'music' | 'soundEffect'> = {
  describe: (selection: AiResolvedSelection) => AiVariantDescriptor
  execute: (
    input: M extends 'image'
      ? AiProviderImageExecutionContext
      : M extends 'video'
        ? AiProviderVideoExecutionContext
        : M extends 'music'
          ? AiProviderMusicExecutionContext
          : AiProviderSoundEffectExecutionContext,
  ) => Promise<GenerateResult>
}

export type AiProviderLanguageModelAdapter = {
  create: (input: AiProviderLanguageModelContext) => LanguageModel
}

export type AiProviderLlmSessionContext = {
  kind: 'llm' | 'vision'
  userId: string
  projectId?: string
  action?: string
  modelKey: string
  explicitSessionId?: string
}

export type AiProviderConnectionTestStepName = 'models' | 'textGen' | 'imageGen' | 'credits'

export type AiProviderConnectionTestStep = {
  name: AiProviderConnectionTestStepName
  status: 'pass' | 'fail' | 'skip'
  message: string
  model?: string
  detail?: string
}

export type AiProviderConnectionTestReport = {
  success: boolean
  steps: AiProviderConnectionTestStep[]
}

export type AiProviderLlmConnectionInput = {
  apiKey: string
  baseUrl?: string
  model?: string
}

export type AiProviderLlmConnectionResult = {
  model?: string
  answer?: string
}

export type AiProviderConnectionTester = {
  testLlm?: (input: AiProviderLlmConnectionInput) => Promise<AiProviderLlmConnectionResult>
  diagnose: (input: { apiKey: string; baseUrl?: string; llmModel?: string }) => Promise<AiProviderConnectionTestReport>
}

export interface AiProviderAdapter {
  readonly providerKey: string
  image?: AiProviderMediaModalityAdapter<'image'>
  video?: AiProviderMediaModalityAdapter<'video'>
  music?: AiProviderMediaModalityAdapter<'music'>
  soundEffect?: AiProviderMediaModalityAdapter<'soundEffect'>
  languageModel?: AiProviderLanguageModelAdapter
  resolveLlmSessionId?: (input: AiProviderLlmSessionContext) => string | undefined
  connectionTest?: AiProviderConnectionTester
  completeLlm?: (input: AiLlmExecutionInput) => Promise<AiProviderLlmResult>
  streamLlm?: (input: AiProviderLlmStreamContext) => Promise<AiProviderLlmResult>
  completeVision?: (input: AiProviderVisionExecutionContext) => Promise<AiProviderLlmResult>
}
