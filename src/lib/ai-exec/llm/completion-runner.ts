import OpenAI from 'openai'
import { getProviderConfig } from '@/lib/user-api/runtime-config'
import { getProviderKey } from '@/lib/ai-registry/selection'
import type { ChatCompletionOptions, ChatCompletionStreamCallbacks } from '@/lib/ai-registry/types'
import { getInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import {
  _ulogError,
  llmLogger,
  logLlmRawInput,
  logLlmRawOutput,
  recordCompletionUsage,
  completionUsageSummary,
  resolveLlmRuntimeModel,
} from '@/lib/ai-exec/llm-runtime'
import { RETRY_POLICY, withRetry } from '@/lib/retry'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { describeLlmVariantBase } from '@/lib/ai-exec/llm-descriptor'
import { validateAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import { emitStreamStage, resolveStreamStepMeta } from '@/lib/ai-providers/shared/llm-support'
import type { AiLlmExecutionInput, AiLlmExecutionResult, ChatMessage } from '@/lib/ai-registry/types'
import { resolveReasoningEffort } from '@/lib/ai-exec/reasoning-effort'

ensureAiCatalogsRegistered()

async function executeLlmCompletionViaAdapter(
  input: AiLlmExecutionInput,
): Promise<AiLlmExecutionResult> {
  const provider = resolveAiProviderAdapter(input.selection.provider)
  if (!provider.completeLlm) {
    throw new Error(`UNSUPPORTED_LLM_PROVIDER: ${input.providerKey}`)
  }
  const result = await provider.completeLlm(input)
  return {
    ...result,
    usage: result.usage ?? completionUsageSummary(result.completion),
  }
}

export async function chatCompletionStream(
  userId: string,
  model: string | null | undefined,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
  callbacks?: ChatCompletionStreamCallbacks,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const streamStep = resolveStreamStepMeta(options)
  emitStreamStage(callbacks, streamStep, 'submit')
  if (!model) {
    const error = new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
    callbacks?.onError?.(error, streamStep)
    throw error
  }

  const selection = await resolveLlmRuntimeModel(userId, model)
  const resolvedModelId = selection.modelId
  const provider = selection.provider
  const providerKey = getProviderKey(provider).toLowerCase()
  const providerConfig = await getProviderConfig(userId, provider)
  const projectId =
    typeof options.projectId === 'string' && options.projectId.trim().length > 0
      ? options.projectId.trim()
      : undefined
  const reasoningEffort = await resolveReasoningEffort({
    userId,
    modelKey: selection.modelKey,
    purpose: 'analysis',
    projectId,
    explicit: options.reasoningEffort,
  })
  const resolvedOptions = { ...options, reasoningEffort }

  validateAiOptions({
    schema: describeLlmVariantBase({ modality: 'llm', selection, executionMode: 'stream' }).optionSchema,
    options: resolvedOptions,
    context: `llm_stream:${selection.modelKey}`,
  })

  const temperature = options.temperature ?? 0.7
  const reasoning = options.reasoning ?? true
  const providerRuntime = resolveAiProviderAdapter(provider)
  const openRouterSessionId = providerRuntime.resolveLlmSessionId?.({
    kind: 'llm',
    userId,
    projectId,
    action: options.action,
    modelKey: selection.modelKey,
    explicitSessionId: options.openRouterSessionId,
  })
  logLlmRawInput({
    userId,
    projectId,
    provider: providerKey,
    modelId: resolvedModelId,
    modelKey: selection.modelKey,
    stream: true,
    reasoning,
    reasoningEffort,
    temperature,
    action: options.action,
    openRouterSessionId,
    messages,
  })

  if (!providerRuntime.streamLlm) {
    const error = new Error(`UNSUPPORTED_STREAM_PROVIDER: ${providerKey}`)
    callbacks?.onError?.(error, streamStep)
    throw error
  }
  const streamLlm = providerRuntime.streamLlm

  let mainTextChunkEmitted = false
  const wrappedCallbacks: ChatCompletionStreamCallbacks | undefined = callbacks
    ? {
      ...callbacks,
      onChunk: (chunk) => {
        if (chunk.kind === 'text' && chunk.delta.trim().length > 0) mainTextChunkEmitted = true
        callbacks.onChunk?.(chunk)
      },
    }
    : undefined

  try {
    const streamOptions = openRouterSessionId
      ? { ...resolvedOptions, openRouterSessionId }
      : resolvedOptions
    const result = await withRetry({
      scope: `llm_stream:${selection.modelKey}`,
      policy: RETRY_POLICY.llmStream,
      shouldRetry: () => !mainTextChunkEmitted,
      run: async () => await streamLlm({
        userId,
        selection,
        providerConfig,
        messages,
        options: streamOptions,
        callbacks: wrappedCallbacks,
      }),
    })
    logLlmRawOutput({
      userId,
      projectId,
      provider: result.logProvider,
      modelId: resolvedModelId,
      modelKey: selection.modelKey,
      stream: true,
      action: options.action,
      text: result.text,
      reasoning: result.reasoning,
      termination: result.termination,
      usage: result.usage ?? undefined,
      providerResponse: result.successDetails?.openRouterResponse ?? null,
    })
    recordCompletionUsage(resolvedModelId, result.completion)
    return result.completion
  } catch (error) {
    if (typeof llmLogger.error === 'function') {
      llmLogger.error({
        audit: false,
        action: 'llm.stream.failed',
        message: '[LLM] stream provider failed',
        userId,
        projectId,
        provider: providerKey,
        details: {
          model: { id: resolvedModelId, key: selection.modelKey },
          action: options.action ?? null,
        },
        error,
      })
    }
    callbacks?.onError?.(error, streamStep)
    throw error
  }
}

export async function runChatCompletion(
  userId: string,
  model: string | null | undefined,
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const internalCallbacks = getInternalLLMStreamCallbacks()
  if (internalCallbacks && !options.__skipAutoStream) {
    return await chatCompletionStream(
      userId,
      model,
      messages,
      { ...options, __skipAutoStream: true },
      internalCallbacks,
    )
  }

  if (!model) {
    _ulogError('[LLM] 模型未配置，调用栈:', new Error().stack)
    throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
  }

  const selection = await resolveLlmRuntimeModel(userId, model)
  const resolvedModelId = selection.modelId
  const provider = selection.provider
  const providerKey = getProviderKey(provider).toLowerCase()
  const providerConfig = await getProviderConfig(userId, provider)
  const projectId =
    typeof options.projectId === 'string' && options.projectId.trim().length > 0
      ? options.projectId.trim()
      : undefined
  const reasoningEffort = await resolveReasoningEffort({
    userId,
    modelKey: selection.modelKey,
    purpose: 'analysis',
    projectId,
    explicit: options.reasoningEffort,
  })
  const resolvedOptions = { ...options, reasoningEffort }

  validateAiOptions({
    schema: describeLlmVariantBase({ modality: 'llm', selection, executionMode: 'sync' }).optionSchema,
    options: resolvedOptions,
    context: `llm:${selection.modelKey}`,
  })

  const {
    temperature = 0.7,
    reasoning = true,
  } = resolvedOptions
  const openRouterSessionId = resolveAiProviderAdapter(provider).resolveLlmSessionId?.({
    kind: 'llm',
    userId,
    projectId,
    action: options.action,
    modelKey: selection.modelKey,
    explicitSessionId: options.openRouterSessionId,
  })
  logLlmRawInput({
    userId,
    projectId,
    provider: providerKey,
    modelId: resolvedModelId,
    modelKey: selection.modelKey,
    stream: false,
    reasoning,
    reasoningEffort,
    temperature,
    action: options.action,
    openRouterSessionId,
    messages,
  })

  return await withRetry({
    scope: `llm:${selection.modelKey}`,
    policy: RETRY_POLICY.llm,
    run: async ({ attempt, maxAttempts }) => {
      const attemptStartedAt = Date.now()
      const result = await executeLlmCompletionViaAdapter({
        userId,
        providerKey,
        selection,
        providerConfig,
        messages,
        temperature,
        reasoning,
        reasoningEffort,
        openRouterSessionId,
      })
      logLlmRawOutput({
        userId,
        projectId,
        provider: result.logProvider,
        modelId: resolvedModelId,
        modelKey: selection.modelKey,
        stream: false,
        action: options.action,
        text: result.text,
        reasoning: result.reasoning,
        termination: result.termination,
        usage: result.usage,
        providerResponse: result.successDetails?.openRouterResponse ?? null,
      })
      recordCompletionUsage(resolvedModelId, result.completion)
      llmLogger.info({
        action: 'llm.call.success',
        message: 'llm call succeeded',
        provider: result.logProvider,
        durationMs: Date.now() - attemptStartedAt,
        details: {
          model: resolvedModelId,
          attempt,
          maxAttempts,
          ...(result.successDetails || {}),
        },
      })
      return result.completion
    },
    onAttemptFailed: ({ error, attempt, maxAttempts, raw }) => {
      llmLogger.warn({
        action: 'llm.call.attempt_failed',
        message: error.message || 'llm call attempt failed',
        provider,
        details: {
          model: resolvedModelId,
          attempt,
          maxAttempts,
        },
        error: raw,
      })
    },
  })
}
