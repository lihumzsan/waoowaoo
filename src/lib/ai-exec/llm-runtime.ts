import { createHash } from 'node:crypto'
import { recordTextUsage as recordBillingTextUsage } from '@/lib/billing/runtime-usage'
import { resolveModelSelection } from '@/lib/user-api/runtime-config'
import { createScopedLogger } from '@/lib/logging/core'
import { getLogContext } from '@/lib/logging/context'
import type { ProviderChatMessageContent } from '@/lib/ai-providers/shared/llm-support'
import type { ReasoningEffort } from '@/lib/ai-registry/reasoning-effort'
import type { AiLlmUsage } from '@/lib/ai-registry/types'

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

/**
 * `llm.raw.input` / `llm.raw.output` are privacy-preserving summaries: they
 * keep model identity, usage, finish reason, message counts, char counts and
 * a sha256 prefix for content identity, and deliberately never log message,
 * output or reasoning content. The action ids are kept stable so existing
 * log tooling keeps matching the same call points.
 */
function sha256Prefix16(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
}

function summarizeText(value: string): { chars: number; sha256: string } {
  return {
    chars: value.length,
    sha256: sha256Prefix16(value),
  }
}

function summarizeLlmMessages(messages: LlmRawMessage[]): {
  count: number
  chars: number
  sha256: string
} {
  const serialized = JSON.stringify(messages)
  return {
    count: messages.length,
    chars: serialized.length,
    sha256: sha256Prefix16(serialized),
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
  reasoningEffort: ReasoningEffort
  action?: string
  openRouterSessionId?: string
  messages: LlmRawMessage[]
}) {
  llmLogger.info({
    audit: true,
    action: 'llm.raw.input',
    message: 'llm input summary',
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
        reasoning: params.reasoning,
        reasoningEffort: params.reasoningEffort,
        openRouterSessionId: params.openRouterSessionId ?? null,
      },
      messages: summarizeLlmMessages(params.messages),
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
  usage?: AiLlmUsage | null
  providerResponse?: unknown
}) {
  const logContext = getLogContext()
  const isEmpty = !params.text
  const text = summarizeText(params.text)
  const reasoning = summarizeText(params.reasoning)
  const logPayload = {
    audit: true,
    action: 'llm.raw.output',
    message: isEmpty ? 'llm output summary [EMPTY]' : 'llm output summary',
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
        textChars: text.chars,
        textSha256: text.sha256,
        reasoningChars: reasoning.chars,
        reasoningSha256: reasoning.sha256,
        empty: isEmpty || undefined,
      },
      taskAttempt: logContext.taskAttempt ?? null,
      termination: params.termination ?? null,
      usage: params.usage || null,
    },
  }
  if (isEmpty) {
    llmLogger.warn(logPayload)
  } else {
    llmLogger.info(logPayload)
  }
}

export function recordLlmUsage(model: string, usage: AiLlmUsage) {
  recordBillingTextUsage({
    model,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheHitRate: usage.cacheHitRate,
    providerCostCredits: usage.providerCostCredits,
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
