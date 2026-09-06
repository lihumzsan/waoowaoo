import type {
  AiResolvedSelection,
  AiVariantDescriptor,
} from '@/lib/ai-registry/types'
import type { MusicKeyScale, MusicTimeSignature } from '@/lib/workspace-resource/music-parameter-contract'
import type { ExternalOperationId } from '@/lib/external-operation/registry'
import type { FailureRecord } from '@/lib/errors/failure'
import type { MusicCompositionPlan } from '@/lib/music/composition-plan'

export type GenerateResult = {
  readonly success: true
  imageUrl?: string
  imageUrls?: string[]
  imageBase64?: string
  videoUrl?: string
  audioUrl?: string
  audioBase64?: string
  audioMimeType?: string
  metadata?: Record<string, unknown>
  requestId?: string
  async?: boolean
  endpoint?: string
  externalId?: string
}

export type AiProviderFailurePhase =
  | 'submit'
  | 'poll'
  | 'cancel'
  | 'result'
  | 'stream'
  | 'connection'
  | 'search'

export type AiProviderFailureNormalizationInput = {
  readonly error: unknown
  readonly phase: AiProviderFailurePhase
  readonly operation?: ExternalOperationId
  readonly attempts?: number
}

export type AiProviderFailureAdapter = {
  readonly providerKey: string
  readonly normalize: (input: AiProviderFailureNormalizationInput) => FailureRecord
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
  logicalInvocationIdentity: string
  selection: AiResolvedSelection & {
    provider: string
    modelId: string
    modelKey: string
  }
  imageUrl: string
  options?: {
    prompt?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    generateAudio?: boolean
    lastFrameImageUrl?: string
    referenceImages?: string[]
    referenceAudios?: string[]
    referenceVideos?: string[]
    continuationVideoUrl?: string
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
  generation:
    | { readonly kind: 'prompt'; readonly prompt: string }
    | { readonly kind: 'composition_plan'; readonly compositionPlan: MusicCompositionPlan }
  options?: {
    negativePrompt?: string
    durationSeconds?: number
    providerDurationSeconds?: number
    vocalMode?: 'instrumental' | 'vocal'
    lyrics?: string
    genre?: string
    mood?: string
    bpm?: number
    keyScale?: MusicKeyScale
    timeSignature?: MusicTimeSignature
    outputFormat?: 'mp3' | 'wav'
    [key: string]: unknown
  }
}

export type AiProviderSoundExecutionContext = {
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
    outputFormat?: 'mp3'
    [key: string]: unknown
  }
}

type AiProviderMediaExecutionContext<M extends 'image' | 'video' | 'music' | 'sound'> =
  M extends 'image'
    ? AiProviderImageExecutionContext
    : M extends 'video'
      ? AiProviderVideoExecutionContext
      : M extends 'music'
        ? AiProviderMusicExecutionContext
        : AiProviderSoundExecutionContext

export type AiProviderPreparedMediaExecution = {
  readonly execute: () => Promise<GenerateResult>
  readonly cleanup: () => Promise<void>
}

type AiProviderMediaModalityAdapterBase = {
  describe: (selection: AiResolvedSelection) => AiVariantDescriptor
}

type AiProviderDirectMediaModalityAdapter<M extends 'image' | 'video' | 'music' | 'sound'> =
  AiProviderMediaModalityAdapterBase & {
    execute: (input: AiProviderMediaExecutionContext<M>) => Promise<GenerateResult>
    prepare?: never
  }

type AiProviderPreparedMediaModalityAdapter<M extends 'image' | 'video' | 'music' | 'sound'> =
  AiProviderMediaModalityAdapterBase & {
    execute?: never
    prepare: (
      input: AiProviderMediaExecutionContext<M>,
    ) => Promise<AiProviderPreparedMediaExecution>
  }

export type AiProviderMediaModalityAdapter<M extends 'image' | 'video' | 'music' | 'sound'> =
  AiProviderDirectMediaModalityAdapter<M> | AiProviderPreparedMediaModalityAdapter<M>

export type AiProviderConnectionTestStepName = 'models' | 'textGen' | 'imageGen' | 'musicGen'

export type AiProviderConnectionTestMessageKey =
  | 'connectionTest.authInvalid'
  | 'connectionTest.emptyResponse'
  | 'connectionTest.modelsOk'
  | 'connectionTest.networkError'
  | 'connectionTest.providerError'
  | 'connectionTest.rateLimited'
  | 'connectionTest.skippedModelsFailure'
  | 'connectionTest.skippedExternalCall'
  | 'connectionTest.textGenerationOk'
  | 'connectionTest.timeout'

export type AiProviderConnectionTestStep = {
  name: AiProviderConnectionTestStepName
  status: 'pass' | 'fail' | 'skip'
  messageKey: AiProviderConnectionTestMessageKey
  model?: string
  diagnostic?: string
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
  readonly failure: AiProviderFailureAdapter
  image?: AiProviderMediaModalityAdapter<'image'>
  video?: AiProviderMediaModalityAdapter<'video'>
  music?: AiProviderMediaModalityAdapter<'music'>
  sound?: AiProviderMediaModalityAdapter<'sound'>
  connectionTest?: AiProviderConnectionTester
}
