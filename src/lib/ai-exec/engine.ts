import { logInfo as _ulogInfo } from '@/lib/logging/core'
import type { GenerateResult } from '@/lib/ai-providers/runtime-types'
import type {
  AiModality,
  AiLlmExecutionResult,
  AiStepExecutionInput,
  AiStepExecutionResult,
  AiVisionStepExecutionInput,
  AiVisionStepExecutionResult,
  AiLlmCallOptions,
  AiLlmStreamCallbacks,
  ChatMessage,
} from '@/lib/ai-registry/types'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { runLlmCompletion, runLlmStream } from '@/lib/ai-exec/llm/completion-runner'
import {
  runVisionCompletion,
  runVisionStream,
} from '@/lib/ai-exec/llm/vision-runner'
import { parseStoredAiLlmExecutionResult } from '@/lib/ai-exec/llm/result-projector'
import { AppError, toAppError } from '@/lib/errors/app-error'
import { getLogContext } from '@/lib/logging/context'
import { waitForAsyncProviderResult } from '@/lib/ai-exec/async-wait'
import { ProviderPermanentFailureError, ProviderTerminalFailureError } from '@/lib/ai-exec/provider-errors'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'
import {
  executeTaskDurableInvocation,
  executeTaskProviderInvocation,
  markTaskProviderInvocationRetryable,
  type TaskProviderInvocation,
  type TaskProviderInvocationRoute,
} from '@/lib/task/provider-invocation'
import { resolveProviderRouteSet } from '@/lib/ai-registry/provider-route-set'
import type { AiResolvedSelection } from '@/lib/ai-registry/types'

export type AiMediaExecutionModality = Extract<AiModality, 'image' | 'video' | 'music' | 'voice'>

export type AiImageExecutionOptions = {
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
}

export type AiVideoExecutionOptions = {
  prompt?: string
  duration?: number
  fps?: number
  resolution?: string
  aspectRatio?: string
  generateAudio?: boolean
  lastFrameImageUrl?: string
  referenceImages?: string[]
  referenceAudios?: string[]
  [key: string]: string | number | boolean | string[] | undefined
}

export type AiMusicExecutionOptions = {
  negativePrompt?: string
  durationSeconds?: number
  vocalMode?: 'instrumental' | 'vocal'
  genre?: string
  mood?: string
  bpm?: number
  outputFormat?: 'mp3' | 'wav'
  /** Video conditioning input; only valid when the selected music model declares `maxReferenceVideos`. */
  referenceVideoUrl?: string
  referenceVideoDurationMs?: number
}

export type AiVoiceExecutionOptions = {
  language?: string
}

export type AiLlmExecutionInput = {
  modality: 'llm'
  userId: string
  model: string | null | undefined
  messages: ChatMessage[]
  options?: AiLlmCallOptions
}

export type AiLlmStreamExecutionInput = AiLlmExecutionInput & {
  callbacks?: AiLlmStreamCallbacks
}

export type AiVisionExecutionInput = {
  modality: 'vision'
  userId: string
  model: string | null | undefined
  textPrompt: string
  imageUrls?: string[]
  options?: AiLlmCallOptions
}

export type AiVisionStreamExecutionInput = AiVisionExecutionInput & {
  callbacks?: AiLlmStreamCallbacks
}

export type AiMediaExecutionInput =
  | {
    modality: 'image'
    userId: string
    modelKey: string
    prompt: string
    options?: AiImageExecutionOptions
  }
  | {
    modality: 'video'
    userId: string
    modelKey: string
    imageUrl: string
    options?: AiVideoExecutionOptions
  }
  | {
    modality: 'music'
    userId: string
    modelKey: string
    prompt: string
    options?: AiMusicExecutionOptions
  }
  | {
    modality: 'voice'
    userId: string
    modelKey: string
    description: string
    text: string
    options?: AiVoiceExecutionOptions
  }

export async function executeMediaGeneration(
  input: AiMediaExecutionInput,
  invocation?: TaskProviderInvocation,
): Promise<GenerateResult> {
  const selection = await resolveModelSelection(input.userId, input.modelKey, input.modality)
  _ulogInfo(`[ai-exec:${input.modality}] resolved model selection: ${selection.modelKey}`)
  const buildRoute = (routeSelection: AiResolvedSelection): TaskProviderInvocationRoute<GenerateResult> => {
    const adapter = resolveAiProviderAdapter(routeSelection.provider)
    switch (input.modality) {
    case 'image': {
      const modalityAdapter = adapter[input.modality]
      if (!modalityAdapter) {
        throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${routeSelection.provider}:${input.modality}`)
      }
      return {
        provider: routeSelection.provider,
        modelKey: routeSelection.modelKey,
        request: { ...input, modelKey: routeSelection.modelKey },
        execute: async () => {
          const descriptor = modalityAdapter.describe(routeSelection)
          const options = normalizeAiOptions({
            schema: descriptor.optionSchema,
            options: input.options,
            context: `${input.modality}:${routeSelection.modelKey}`,
          }) as AiImageExecutionOptions | undefined
          return await modalityAdapter.execute({
            userId: input.userId,
            selection: routeSelection,
            prompt: input.prompt,
            options,
          })
        },
      }
    }
    case 'video': {
      const modalityAdapter = adapter[input.modality]
      if (!modalityAdapter) {
        throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${routeSelection.provider}:${input.modality}`)
      }
      return {
        provider: routeSelection.provider,
        modelKey: routeSelection.modelKey,
        request: { ...input, modelKey: routeSelection.modelKey },
        execute: async () => {
          const descriptor = modalityAdapter.describe(routeSelection)
          const options = normalizeAiOptions({
            schema: descriptor.optionSchema,
            options: input.options,
            context: `${input.modality}:${routeSelection.modelKey}`,
          }) as AiVideoExecutionOptions | undefined
          return await modalityAdapter.execute({
            userId: input.userId,
            selection: routeSelection,
            imageUrl: input.imageUrl,
            options,
          })
        },
      }
    }
    case 'music': {
      const modalityAdapter = adapter[input.modality]
      if (!modalityAdapter) {
        throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${routeSelection.provider}:${input.modality}`)
      }
      return {
        provider: routeSelection.provider,
        modelKey: routeSelection.modelKey,
        request: { ...input, modelKey: routeSelection.modelKey },
        execute: async () => {
          const descriptor = modalityAdapter.describe(routeSelection)
          const options = normalizeAiOptions({
            schema: descriptor.optionSchema,
            options: input.options,
            context: `${input.modality}:${routeSelection.modelKey}`,
          }) as AiMusicExecutionOptions | undefined
          return await modalityAdapter.execute({
            userId: input.userId,
            selection: routeSelection,
            prompt: input.prompt,
            options,
          })
        },
      }
    }
    case 'voice': {
      const modalityAdapter = adapter[input.modality]
      if (!modalityAdapter) {
        throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${routeSelection.provider}:${input.modality}`)
      }
      return {
        provider: routeSelection.provider,
        modelKey: routeSelection.modelKey,
        request: { ...input, modelKey: routeSelection.modelKey },
        execute: async () => {
          const descriptor = modalityAdapter.describe(routeSelection)
          const options = normalizeAiOptions({
            schema: descriptor.optionSchema,
            options: input.options,
            context: `${input.modality}:${routeSelection.modelKey}`,
          }) as AiVoiceExecutionOptions | undefined
          return await modalityAdapter.execute({
            userId: input.userId,
            selection: routeSelection,
            description: input.description,
            text: input.text,
            options,
          })
        },
      }
    }
    }
  }
  const taskId = getLogContext().taskId
  let result: GenerateResult
  if (!taskId) {
    result = await buildRoute(selection).execute()
  } else {
    if (!invocation) throw new Error(`TASK_PROVIDER_INVOCATION_KEY_REQUIRED:${taskId}:${input.modality}`)
    const routeSet = resolveProviderRouteSet(input.modality, selection.modelKey)
    const routes = routeSet.routes.map((route) => buildRoute({
      provider: route.provider,
      modelId: route.modelId,
      modelKey: route.modelKey,
      variantSubKind: 'official',
    }))
    result = await executeTaskProviderInvocation({
      taskId,
      invocation,
      modality: input.modality,
      logicalCapabilityId: routeSet.logicalCapabilityId,
      primaryModelKey: routeSet.primaryModelKey,
      routes,
    })
  }

  if ((input.modality !== 'music' && input.modality !== 'voice') || !result.async) return result
  const externalId = result.externalId?.trim()
  if (!externalId) throw new Error(`ASYNC_${input.modality.toUpperCase()}_EXTERNAL_ID_MISSING`)
  try {
    const completed = await waitForAsyncProviderResult({
      externalId,
      userId: input.userId,
    })
    return {
      ...result,
      async: false,
      audioUrl: completed.url,
    }
  } catch (error) {
    if (error instanceof ProviderTerminalFailureError) {
      if (taskId && invocation) {
        await markTaskProviderInvocationRetryable({ taskId, invocation, error })
      }
      throw new AppError('EXTERNAL_ERROR', error.message, {
        provider: selection.provider,
        details: { externalId },
        cause: error,
      })
    }
    if (error instanceof ProviderPermanentFailureError) {
      throw new AppError('PROVIDER_SUBMISSION_REJECTED', error.message, {
        provider: selection.provider,
        details: { externalId },
        cause: error,
      })
    }
    throw error
  }
}

export async function executeLlmCompletion(input: AiLlmExecutionInput): Promise<AiLlmExecutionResult> {
  return await runLlmCompletion(input.userId, input.model, input.messages, input.options || {})
}

export async function executeLlmStreamCompletion(input: AiLlmStreamExecutionInput): Promise<AiLlmExecutionResult> {
  return await runLlmStream(input.userId, input.model, input.messages, input.options || {}, input.callbacks)
}

export async function executeVisionCompletion(input: AiVisionExecutionInput): Promise<AiLlmExecutionResult> {
  return await runVisionCompletion(
    input.userId,
    input.model,
    input.textPrompt,
    input.imageUrls || [],
    input.options || {},
  )
}

export async function executeVisionStreamCompletion(input: AiVisionStreamExecutionInput): Promise<AiLlmExecutionResult> {
  return await runVisionStream(
    input.userId,
    input.model,
    input.textPrompt,
    input.imageUrls || [],
    input.options || {},
    input.callbacks,
  )
}

export async function generateImage(
  userId: string,
  modelKey: string,
  prompt: string,
  options?: AiImageExecutionOptions,
  invocation?: TaskProviderInvocation,
): Promise<GenerateResult> {
  return await executeMediaGeneration({
    modality: 'image',
    userId,
    modelKey,
    prompt,
    options,
  }, invocation)
}

export async function generateVideo(
  userId: string,
  modelKey: string,
  imageUrl: string,
  options?: AiVideoExecutionOptions,
  invocation?: TaskProviderInvocation,
): Promise<GenerateResult> {
  return await executeMediaGeneration({
    modality: 'video',
    userId,
    modelKey,
    imageUrl,
    options,
  }, invocation)
}

export async function generateMusic(
  userId: string,
  modelKey: string,
  prompt: string,
  options?: AiMusicExecutionOptions,
  invocation?: TaskProviderInvocation,
): Promise<GenerateResult> {
  return await executeMediaGeneration({
    modality: 'music',
    userId,
    modelKey,
    prompt,
    options,
  }, invocation)
}

export async function generateVoice(
  userId: string,
  modelKey: string,
  description: string,
  text: string,
  options?: AiVoiceExecutionOptions,
  invocation?: TaskProviderInvocation,
): Promise<GenerateResult> {
  return await executeMediaGeneration({
    modality: 'voice',
    userId,
    modelKey,
    description,
    text,
    options,
  }, invocation)
}

export function taskAiInvocationKey(input: {
  readonly modality: 'llm' | 'vision'
  readonly action?: string
  readonly meta?: { readonly stepId: string; readonly stepAttempt?: number; readonly stepIndex: number }
}): string {
  const action = input.action?.trim() || ''
  const stepId = input.meta?.stepId.trim() || ''
  if (!action || !stepId || !input.meta) {
    throw new Error(`TASK_AI_INVOCATION_IDENTITY_REQUIRED:${input.modality}`)
  }
  // `stepAttempt` is stream presentation metadata, not a provider invocation
  // identity. Including it here would let a replay submit the same external
  // request under a fresh durable fence.
  return `ai:${input.modality}:${action}:${stepId}:${input.meta.stepIndex}`
}

export async function markTaskAiInvocationRetryable(input: {
  readonly modality: 'llm' | 'vision'
  readonly action?: string
  readonly meta?: { readonly stepId: string; readonly stepAttempt?: number; readonly stepIndex: number }
  readonly error: unknown
}): Promise<void> {
  const taskId = getLogContext().taskId
  if (!taskId) return
  await markTaskProviderInvocationRetryable({
    taskId,
    invocation: { key: taskAiInvocationKey(input) },
    error: input.error,
  })
}

async function executeTaskAwareLlmCompletion(input: {
  readonly modality: 'llm' | 'vision'
  readonly userId: string
  readonly model: string
  readonly action?: string
  readonly meta?: { readonly stepId: string; readonly stepAttempt?: number; readonly stepIndex: number }
  readonly request: unknown
  readonly execute: () => Promise<AiLlmExecutionResult>
}): Promise<AiLlmExecutionResult> {
  const taskId = getLogContext().taskId
  if (!taskId) return await input.execute()
  return await executeTaskDurableInvocation({
    taskId,
    invocation: { key: taskAiInvocationKey(input) },
    modality: input.modality,
    provider: 'llm-runtime',
    modelKey: input.model,
    request: input.request,
    execute: input.execute,
    resultPolicy: {
      parse: parseStoredAiLlmExecutionResult,
      isKnownRejectionError: (error) => !toAppError(error, { context: 'worker' }).retryable,
    },
  })
}

export async function executeAiTextStep(input: AiStepExecutionInput): Promise<AiStepExecutionResult> {
  try {
    const reasoningEffort = await resolveReasoningEffort({
      userId: input.userId,
      modelKey: input.model,
      purpose: 'analysis',
      projectId: input.projectId,
      explicit: input.reasoningEffort,
    })
    const options = {
      reasoning: input.reasoning,
      reasoningEffort,
      projectId: input.projectId,
      action: input.action,
      streamStepId: input.meta.stepId,
      streamStepAttempt: input.meta.stepAttempt || 1,
      streamStepTitle: input.meta.stepTitle,
      streamStepIndex: input.meta.stepIndex,
      streamStepTotal: input.meta.stepTotal,
    }
    return await executeTaskAwareLlmCompletion({
      modality: 'llm',
      userId: input.userId,
      model: input.model,
      action: input.action,
      meta: input.meta,
      request: { messages: input.messages, options },
      execute: async () => await executeLlmCompletion({
        modality: 'llm',
        userId: input.userId,
        model: input.model,
        messages: input.messages,
        options,
      }),
    })
  } catch (error) {
    throw toAppError(error, { context: 'worker' })
  }
}

export async function executeAiVisionStep(input: AiVisionStepExecutionInput): Promise<AiVisionStepExecutionResult> {
  try {
    const reasoningEffort = await resolveReasoningEffort({
      userId: input.userId,
      modelKey: input.model,
      purpose: 'analysis',
      projectId: input.projectId,
      explicit: input.reasoningEffort,
    })
    const options = {
      reasoning: input.reasoning,
      reasoningEffort,
      projectId: input.projectId,
      action: input.action,
      streamStepId: input.meta?.stepId,
      streamStepAttempt: input.meta?.stepAttempt || 1,
      streamStepTitle: input.meta?.stepTitle,
      streamStepIndex: input.meta?.stepIndex,
      streamStepTotal: input.meta?.stepTotal,
    }
    return await executeTaskAwareLlmCompletion({
      modality: 'vision',
      userId: input.userId,
      model: input.model,
      action: input.action,
      meta: input.meta,
      request: { prompt: input.prompt, imageUrls: input.imageUrls, options },
      execute: async () => await executeVisionCompletion({
        modality: 'vision',
        userId: input.userId,
        model: input.model,
        textPrompt: input.prompt,
        imageUrls: input.imageUrls,
        options,
      }),
    })
  } catch (error) {
    throw toAppError(error, { context: 'worker' })
  }
}
