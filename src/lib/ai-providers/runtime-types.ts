import type { LanguageModel, ModelMessage } from 'ai'
import type {
  AiLlmExecutionResult,
  AiLlmMessage,
  AiLlmProtocol,
  AiResolvedSelection,
  AiVariantDescriptor,
  AiLlmProviderConfig,
} from '@/lib/ai-registry/types'
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

export type AiProviderLanguageModelContext = {
  providerKey: string
  selection: {
    provider: string
    modelId: string
    modelKey: string
  }
  providerConfig: AiLlmProviderConfig
  protocol: AiLlmProtocol
  executionMode: 'sync' | 'stream' | 'vision' | 'agent'
  reasoning: boolean
  reasoningEffort: ReasoningEffort
  temperature?: number
  messages?: AiLlmMessage[]
  openRouterSessionId?: string
}

export type AiProviderLanguageModelRequestContext = Omit<AiProviderLanguageModelContext, 'protocol'>
export type AiProviderLanguageModelValidationContext = Pick<
  AiProviderLanguageModelContext,
  'executionMode'
>

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
  prepareTextMessages?: (messages: AiLlmMessage[]) => ModelMessage[]
  validateResult?: (
    result: AiLlmExecutionResult,
    context: AiProviderLanguageModelValidationContext,
  ) => void
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
  languageModel?: AiProviderLanguageModelAdapter
  resolveLlmSessionId?: (input: AiProviderLlmSessionContext) => string | undefined
  connectionTest?: AiProviderConnectionTester
}
