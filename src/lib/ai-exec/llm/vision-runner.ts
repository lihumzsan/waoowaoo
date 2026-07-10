import type OpenAI from 'openai'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { getProviderKey } from '@/lib/ai-registry/selection'
import type { ChatCompletionOptions, ChatCompletionStreamCallbacks } from '@/lib/ai-registry/types'
import { getInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { emitChunkedText } from '@/lib/ai-providers/shared/llm-support'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { getCompletionParts } from '@/lib/ai-exec/llm-helpers'
import {
  _ulogError,
  llmLogger,
  recordCompletionUsage,
  resolveLlmRuntimeModel,
} from '@/lib/ai-exec/llm-runtime'
import { RETRY_POLICY, withRetry } from '@/lib/retry'
import { describeLlmVariantBase } from '@/lib/ai-exec/llm-descriptor'
import { validateAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import type { AiProviderLlmResult, AiProviderVisionExecutionContext } from '@/lib/ai-providers/runtime-types'

ensureAiCatalogsRegistered()

async function executeVisionCompletionViaAdapter(
  input: AiProviderVisionExecutionContext,
): Promise<AiProviderLlmResult> {
  const provider = resolveAiProviderAdapter(input.selection.provider)
  if (provider.completeVision) {
    const result = await provider.completeVision(input)
    return result
  }

  throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${input.selection.provider}:vision`)
}

async function normalizeVisionImageUrls(imageUrls: readonly string[]): Promise<string[]> {
  const normalized: string[] = []
  for (const imageUrl of imageUrls) {
    const trimmed = typeof imageUrl === 'string' ? imageUrl.trim() : ''
    if (!trimmed) continue
    normalized.push(await normalizeToBase64ForGeneration(trimmed))
  }
  return normalized
}

export async function runChatCompletionWithVision(
  userId: string,
  model: string | null | undefined,
  textPrompt: string,
  imageUrls: string[] = [],
  options: ChatCompletionOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const internalCallbacks = getInternalLLMStreamCallbacks()
  if (internalCallbacks && !options.__skipAutoStream) {
    return await runChatCompletionWithVisionStream(
      userId,
      model,
      textPrompt,
      imageUrls,
      { ...options, __skipAutoStream: true },
      internalCallbacks,
    )
  }

  if (!model) {
    _ulogError('[LLM Vision] 模型未配置，调用栈:', new Error().stack)
    throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
  }

  const selection = await resolveLlmRuntimeModel(userId, model)
  const resolvedModelId = selection.modelId
  const provider = selection.provider
  const providerKey = getProviderKey(provider).toLowerCase()

  validateAiOptions({
    schema: describeLlmVariantBase({ modality: 'vision', selection, executionMode: 'sync' }).optionSchema,
    options,
    context: `vision:${selection.modelKey}`,
  })

  const { temperature = 0.7, reasoning = true } = options
  const normalizedImageUrls = await normalizeVisionImageUrls(imageUrls)
  const projectId =
    typeof options.projectId === 'string' && options.projectId.trim().length > 0
      ? options.projectId.trim()
      : undefined
  const openRouterSessionId = resolveAiProviderAdapter(provider).resolveLlmSessionId?.({
    kind: 'vision',
    userId,
    projectId,
    action: options.action,
    modelKey: selection.modelKey,
    explicitSessionId: options.openRouterSessionId,
  })

  return await withRetry({
    scope: `vision:${selection.modelKey}`,
    policy: RETRY_POLICY.llm,
    run: async ({ attempt, maxAttempts }) => {
      const attemptStartedAt = Date.now()
      const providerConfig = await getProviderConfig(userId, provider)
      const result = await executeVisionCompletionViaAdapter({
        userId,
        providerKey,
        selection,
        providerConfig,
        textPrompt,
        imageUrls: normalizedImageUrls,
        temperature,
        reasoning,
        options: openRouterSessionId ? { ...options, openRouterSessionId } : options,
      })
      recordCompletionUsage(resolvedModelId, result.completion)
      llmLogger.info({
        action: 'llm.vision.success',
        message: 'llm vision call succeeded',
        provider: result.logProvider,
        durationMs: Date.now() - attemptStartedAt,
        details: {
          model: resolvedModelId,
          attempt,
          maxAttempts,
          imageCount: normalizedImageUrls.length,
          ...(result.successDetails || {}),
        },
      })
      return result.completion
    },
    onAttemptFailed: ({ error, attempt, maxAttempts, raw }) => {
      llmLogger.warn({
        action: 'llm.vision.attempt_failed',
        message: error.message || 'llm vision attempt failed',
        provider,
        details: {
          model: resolvedModelId,
          attempt,
          maxAttempts,
          imageCount: normalizedImageUrls.length,
        },
        error: raw,
      })
    },
  })
}

export async function runChatCompletionWithVisionStream(
  userId: string,
  model: string | null | undefined,
  textPrompt: string,
  imageUrls: string[] = [],
  options: ChatCompletionOptions = {},
  callbacks?: ChatCompletionStreamCallbacks,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  callbacks?.onStage?.({ stage: 'submit' })
  try {
    callbacks?.onStage?.({ stage: 'fallback' })
    const completion = await runChatCompletionWithVision(userId, model, textPrompt, imageUrls, {
      ...options,
      __skipAutoStream: true,
    })
    const completionParts = getCompletionParts(completion)
    let seq = 1
    if (completionParts.reasoning) {
      seq = emitChunkedText(completionParts.reasoning, callbacks, 'reasoning', seq)
    }
    emitChunkedText(completionParts.text, callbacks, 'text', seq)
    callbacks?.onStage?.({ stage: 'completed' })
    callbacks?.onComplete?.(completionParts.text)
    return completion
  } catch (error) {
    callbacks?.onError?.(error, undefined)
    throw error
  }
}
