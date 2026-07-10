import OpenAI from 'openai'

import { recordTextUsage as recordBillingTextUsage } from '@/lib/billing/runtime-usage'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { createScopedLogger } from '@/lib/logging/core'
import { getLogContext } from '@/lib/logging/context'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'
import type { ProviderChatMessageContent } from '@/lib/ai-providers/shared/llm-support'

export const llmLogger = createScopedLogger({
  module: 'llm.client',
  action: 'llm.call',
})

export const _ulogInfo = (...args: unknown[]) => llmLogger.info(...args)
export const _ulogWarn = (...args: unknown[]) => llmLogger.warn(...args)
export const _ulogError = (...args: unknown[]) => llmLogger.error(...args)

export type LlmRawMessage = {
  role: 'user' | 'assistant' | 'system'
  content: ProviderChatMessageContent
}

type LlmUsage = {
  promptTokens: number
  completionTokens: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  cacheHitRate?: number
  providerCostCredits?: number
}

export function completionUsageSummary(
  completion: OpenAI.Chat.Completions.ChatCompletion | null | undefined,
): LlmUsage | null {
  const usage = completion?.usage as {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
      cache_write_tokens?: number
    } | null
    cost?: number
    total_cost?: number
    provider_cost_credits?: number
  } | undefined
  if (!usage) return null
  const promptTokens = Number(usage.prompt_tokens ?? 0)
  const completionTokens = Number(usage.completion_tokens ?? 0)
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return null
  const cachedInputTokens = Number(usage.prompt_tokens_details?.cached_tokens ?? 0)
  const cacheWriteTokens = Number(usage.prompt_tokens_details?.cache_write_tokens ?? 0)
  const explicitProviderCostCredits = Number(usage.provider_cost_credits)
  const providerCostUsd = Number(usage.cost ?? usage.total_cost)
  return {
    promptTokens,
    completionTokens,
    ...(Number.isFinite(cachedInputTokens) && cachedInputTokens >= 0
      ? { cachedInputTokens }
      : {}),
    ...(Number.isFinite(cacheWriteTokens) && cacheWriteTokens >= 0
      ? { cacheWriteTokens }
      : {}),
    ...(Number.isFinite(cachedInputTokens) && cachedInputTokens >= 0 && promptTokens > 0
      ? { cacheHitRate: cachedInputTokens / promptTokens }
      : {}),
    ...(Number.isFinite(explicitProviderCostCredits) && explicitProviderCostCredits >= 0
      ? { providerCostCredits: explicitProviderCostCredits }
      : Number.isFinite(providerCostUsd) && providerCostUsd >= 0
        ? { providerCostCredits: usdToCredits(providerCostUsd) }
        : {}),
  }
}

export function logLlmRawInput(params: {
  userId: string
  projectId?: string
  provider: string
  modelId: string
  modelKey: string
  stream: boolean
  reasoning: boolean
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
  temperature: number
  action?: string
  openRouterSessionId?: string
  messages: LlmRawMessage[]
}) {
  llmLogger.info({
    audit: true,
    action: 'llm.raw.input',
    message: 'llm raw input',
    userId: params.userId,
    projectId: params.projectId,
    provider: params.provider,
    details: {
      action: params.action || null,
      stream: params.stream,
      model: {
        id: params.modelId,
        key: params.modelKey,
      },
      options: {
        temperature: params.temperature,
        reasoning: params.reasoning,
        reasoningEffort: params.reasoningEffort,
        openRouterSessionId: params.openRouterSessionId ?? null,
      },
      messages: params.messages,
    },
  })
}

export function logLlmRawOutput(params: {
  userId: string
  projectId?: string
  provider: string
  modelId: string
  modelKey: string
  stream: boolean
  action?: string
  text: string
  reasoning: string
  termination?: { readonly kind: string; readonly rawReason: string | null }
  usage?: LlmUsage | null
  providerResponse?: unknown
}) {
  const logContext = getLogContext()
  const isEmpty = !params.text
  const logPayload = {
    audit: true,
    action: 'llm.raw.output',
    message: isEmpty ? 'llm raw output [EMPTY]' : 'llm raw output',
    userId: params.userId,
    projectId: params.projectId,
    provider: params.provider,
    details: {
      action: params.action || null,
      stream: params.stream,
      model: {
        id: params.modelId,
        key: params.modelKey,
      },
      output: {
        reasoning: params.reasoning,
        text: params.text,
        textChars: params.text.length,
        reasoningChars: params.reasoning.length,
        empty: isEmpty || undefined,
      },
      taskAttempt: logContext.taskAttempt ?? null,
      termination: params.termination ?? null,
      usage: params.usage || null,
      providerResponse: params.providerResponse ?? null,
    },
  }
  if (isEmpty) {
    llmLogger.warn(logPayload)
  } else {
    llmLogger.info(logPayload)
  }
}

export function recordCompletionUsage(model: string, completion: OpenAI.Chat.Completions.ChatCompletion) {
  const summary = completionUsageSummary(completion)
  if (!summary) return

  recordBillingTextUsage({
    model,
    inputTokens: summary.promptTokens,
    outputTokens: summary.completionTokens,
    cachedInputTokens: summary.cachedInputTokens,
    cacheWriteTokens: summary.cacheWriteTokens,
    cacheHitRate: summary.cacheHitRate,
    providerCostCredits: summary.providerCostCredits,
  })
}

export interface ResolvedLlmRuntimeModel {
  provider: string
  modelId: string
  modelKey: string
  variantSubKind: 'official'
}

export async function resolveLlmRuntimeModel(
  userId: string,
  model: string,
): Promise<ResolvedLlmRuntimeModel> {
  const selection = await resolveModelSelection(userId, model, 'llm')
  return {
    provider: selection.provider,
    modelId: selection.modelId,
    modelKey: selection.modelKey,
    variantSubKind: 'official',
  }
}
