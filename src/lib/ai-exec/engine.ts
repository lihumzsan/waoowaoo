import OpenAI from 'openai'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import type { GenerateResult } from '@/lib/ai-providers/runtime-types'
import type {
  AiModality,
  AiStepExecutionInput,
  AiStepExecutionResult,
  AiVisionStepExecutionInput,
  AiVisionStepExecutionResult,
  ChatCompletionOptions,
  ChatCompletionStreamCallbacks,
  ChatMessage,
} from '@/lib/ai-registry/types'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { validateAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { runChatCompletion } from '@/lib/ai-exec/llm/completion-runner'
import { chatCompletionStream as runChatCompletionStream } from '@/lib/ai-exec/llm/completion-runner'
import {
  runChatCompletionWithVision,
  runChatCompletionWithVisionStream,
} from '@/lib/ai-exec/llm/vision-runner'
import { getCompletionContent, getCompletionParts } from '@/lib/ai-exec/llm-helpers'
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
} from '@/lib/task/provider-invocation'

export type AiMediaExecutionModality = Extract<AiModality, 'image' | 'video' | 'music'>

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
}

export type AiLlmExecutionInput = {
  modality: 'llm'
  userId: string
  model: string | null | undefined
  messages: ChatMessage[]
  options?: ChatCompletionOptions
}

export type AiLlmStreamExecutionInput = AiLlmExecutionInput & {
  callbacks?: ChatCompletionStreamCallbacks
}

export type AiVisionExecutionInput = {
  modality: 'vision'
  userId: string
  model: string | null | undefined
  textPrompt: string
  imageUrls?: string[]
  options?: ChatCompletionOptions
}

export type AiVisionStreamExecutionInput = AiVisionExecutionInput & {
  callbacks?: ChatCompletionStreamCallbacks
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

export async function executeMediaGeneration(
  input: AiMediaExecutionInput,
  invocation?: TaskProviderInvocation,
): Promise<GenerateResult> {
  const selection = await resolveModelSelection(input.userId, input.modelKey, input.modality)
  _ulogInfo(`[ai-exec:${input.modality}] resolved model selection: ${selection.modelKey}`)
  const adapter = resolveAiProviderAdapter(selection.provider)
  const execute = async (): Promise<GenerateResult> => {
    switch (input.modality) {
    case 'image': {
      const modalityAdapter = adapter[input.modality]
      if (!modalityAdapter) {
        throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${selection.provider}:${input.modality}`)
      }
      const descriptor = modalityAdapter.describe(selection)
      validateAiOptions({
        schema: descriptor.optionSchema,
        options: input.options,
        context: `${input.modality}:${selection.modelKey}`,
      })
      return await modalityAdapter.execute({
        userId: input.userId,
        selection,
        prompt: input.prompt,
        options: input.options,
      })
    }
    case 'video': {
      const modalityAdapter = adapter[input.modality]
      if (!modalityAdapter) {
        throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${selection.provider}:${input.modality}`)
      }
      const descriptor = modalityAdapter.describe(selection)
      validateAiOptions({
        schema: descriptor.optionSchema,
        options: input.options,
        context: `${input.modality}:${selection.modelKey}`,
      })
      return await modalityAdapter.execute({
        userId: input.userId,
        selection,
        imageUrl: input.imageUrl,
        options: input.options,
      })
    }
    case 'music': {
      const modalityAdapter = adapter[input.modality]
      if (!modalityAdapter) {
        throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${selection.provider}:${input.modality}`)
      }
      const descriptor = modalityAdapter.describe(selection)
      validateAiOptions({
        schema: descriptor.optionSchema,
        options: input.options,
        context: `${input.modality}:${selection.modelKey}`,
      })
      return await modalityAdapter.execute({
        userId: input.userId,
        selection,
        prompt: input.prompt,
        options: input.options,
      })
    }
    }
  }
  const taskId = getLogContext().taskId
  let result: GenerateResult
  if (!taskId) {
    result = await execute()
  } else {
    if (!invocation) throw new Error(`TASK_PROVIDER_INVOCATION_KEY_REQUIRED:${taskId}:${input.modality}`)
    result = await executeTaskProviderInvocation({
      taskId,
      invocation,
      modality: input.modality,
      provider: selection.provider,
      modelKey: selection.modelKey,
      request: input,
      execute,
    })
  }

  if (input.modality !== 'music' || !result.async) return result
  const externalId = result.externalId?.trim()
  if (!externalId) throw new Error('ASYNC_MUSIC_EXTERNAL_ID_MISSING')
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

export async function executeLlmCompletion(input: AiLlmExecutionInput): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await runChatCompletion(input.userId, input.model, input.messages, input.options || {})
}

export async function executeLlmStreamCompletion(input: AiLlmStreamExecutionInput): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await runChatCompletionStream(input.userId, input.model, input.messages, input.options || {}, input.callbacks)
}

export async function executeVisionCompletion(input: AiVisionExecutionInput): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await runChatCompletionWithVision(
    input.userId,
    input.model,
    input.textPrompt,
    input.imageUrls || [],
    input.options || {},
  )
}

export async function executeVisionStreamCompletion(input: AiVisionStreamExecutionInput): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await runChatCompletionWithVisionStream(
    input.userId,
    input.model,
    input.textPrompt,
    input.imageUrls || [],
    input.options || {},
    input.callbacks,
  )
}

export async function chatCompletion(
  userId: string,
  model: string | null | undefined,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await executeLlmCompletion({ modality: 'llm', userId, model, messages, options })
}

export async function chatCompletionStream(
  userId: string,
  model: string | null | undefined,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
  callbacks?: ChatCompletionStreamCallbacks,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await executeLlmStreamCompletion({ modality: 'llm', userId, model, messages, options, callbacks })
}

export async function chatCompletionWithVision(
  userId: string,
  model: string | null | undefined,
  textPrompt: string,
  imageUrls: string[] = [],
  options: ChatCompletionOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await executeVisionCompletion({ modality: 'vision', userId, model, textPrompt, imageUrls, options })
}

export async function chatCompletionWithVisionStream(
  userId: string,
  model: string | null | undefined,
  textPrompt: string,
  imageUrls: string[] = [],
  options: ChatCompletionOptions = {},
  callbacks?: ChatCompletionStreamCallbacks,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return await executeVisionStreamCompletion({ modality: 'vision', userId, model, textPrompt, imageUrls, options, callbacks })
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

function toInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  return 0
}

function extractUsage(completion: AiStepExecutionResult['completion']) {
  const promptTokens = toInt(completion.usage?.prompt_tokens)
  const completionTokens = toInt(completion.usage?.completion_tokens)
  const totalTokens = toInt(completion.usage?.total_tokens) || (promptTokens + completionTokens)
  return {
    promptTokens,
    completionTokens,
    totalTokens,
  }
}

function extractTextAndReasoning(completion: OpenAI.Chat.Completions.ChatCompletion): {
  text: string
  reasoning: string
} {
  try {
    return getCompletionParts(completion)
  } catch {
    const text = typeof getCompletionContent === 'function'
      ? (getCompletionContent(completion) || '')
      : ''
    return {
      text,
      reasoning: '',
    }
  }
}

function parseStoredChatCompletion(value: unknown): OpenAI.Chat.Completions.ChatCompletion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !Array.isArray(record.choices)) {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID')
  }
  return value as OpenAI.Chat.Completions.ChatCompletion
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
  readonly execute: () => Promise<OpenAI.Chat.Completions.ChatCompletion>
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
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
      parse: parseStoredChatCompletion,
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
      temperature: input.temperature,
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
    const completion = await executeTaskAwareLlmCompletion({
      modality: 'llm',
      userId: input.userId,
      model: input.model,
      action: input.action,
      meta: input.meta,
      request: { messages: input.messages, options },
      execute: async () => await chatCompletion(input.userId, input.model, input.messages, options),
    })

    const parts = extractTextAndReasoning(completion)
    return {
      text: parts.text,
      reasoning: parts.reasoning,
      usage: extractUsage(completion),
      completion,
    }
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
      temperature: input.temperature,
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
    const completion = await executeTaskAwareLlmCompletion({
      modality: 'vision',
      userId: input.userId,
      model: input.model,
      action: input.action,
      meta: input.meta,
      request: { prompt: input.prompt, imageUrls: input.imageUrls, options },
      execute: async () => await chatCompletionWithVision(
        input.userId,
        input.model,
        input.prompt,
        input.imageUrls,
        options,
      ),
    })

    const parts = extractTextAndReasoning(completion)
    return {
      text: parts.text,
      reasoning: parts.reasoning,
      usage: extractUsage(completion),
      completion,
    }
  } catch (error) {
    throw toAppError(error, { context: 'worker' })
  }
}
