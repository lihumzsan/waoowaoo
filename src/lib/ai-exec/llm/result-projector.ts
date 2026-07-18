import type {
  FinishReason,
  LanguageModelResponseMetadata,
  LanguageModelUsage,
  ProviderMetadata,
} from 'ai'
import { usdToCredits } from '@/lib/ai-registry/pricing-currency'
import type {
  AiLlmExecutionResult,
  AiLlmTermination,
  AiLlmUsage,
  AiUnknownObject,
} from '@/lib/ai-registry/types'

export type AiSdkLanguageModelResult = {
  text: string
  reasoningText?: string
  finishReason: FinishReason
  rawFinishReason?: string
  usage: LanguageModelUsage
  response: LanguageModelResponseMetadata
  providerMetadata?: ProviderMetadata
}

export function reconcileAiSdkStreamFinal(
  streamed: string,
  finalValue: string,
  kind: 'text' | 'reasoning',
): { value: string; suffix: string } {
  if (!streamed) return { value: finalValue, suffix: finalValue }
  if (!finalValue) return { value: streamed, suffix: '' }
  if (!finalValue.startsWith(streamed)) {
    throw new Error(`LLM_STREAM_FINAL_MISMATCH:${kind}`)
  }
  return { value: finalValue, suffix: finalValue.slice(streamed.length) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toTokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0
}

function projectTermination(finishReason: FinishReason, rawFinishReason?: string): AiLlmTermination {
  const kind: AiLlmTermination['kind'] = finishReason === 'stop'
    ? 'normal'
    : finishReason === 'length'
      ? 'token_limit'
      : finishReason === 'content-filter'
        ? 'safety'
        : finishReason === 'tool-calls'
          ? 'tool_call'
          : 'unknown'
  return {
    kind,
    rawReason: rawFinishReason?.trim() || finishReason,
  }
}

function readOpenRouterCost(providerMetadata: ProviderMetadata | undefined): number | null {
  const openRouter = isRecord(providerMetadata?.openrouter) ? providerMetadata.openrouter : null
  const usage = isRecord(openRouter?.usage) ? openRouter.usage : null
  const cost = usage?.cost
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
}

function projectUsage(
  usage: LanguageModelUsage,
  providerMetadata: ProviderMetadata | undefined,
): AiLlmUsage {
  const promptTokens = toTokenCount(usage.inputTokens)
  const completionTokens = toTokenCount(usage.outputTokens)
  const totalTokens = toTokenCount(usage.totalTokens) || promptTokens + completionTokens
  const cachedInputTokens = toTokenCount(usage.inputTokenDetails.cacheReadTokens)
  const cacheWriteTokens = toTokenCount(usage.inputTokenDetails.cacheWriteTokens)
  const openRouterCostUsd = readOpenRouterCost(providerMetadata)
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
    ...(cachedInputTokens > 0 && promptTokens > 0
      ? { cacheHitRate: cachedInputTokens / promptTokens }
      : {}),
    ...(openRouterCostUsd !== null
      ? { providerCostCredits: usdToCredits(openRouterCostUsd) }
      : {}),
  }
}

export function projectAiSdkLanguageModelResult(input: {
  provider: string
  modelId: string
  result: AiSdkLanguageModelResult
}): AiLlmExecutionResult {
  const providerMetadata = input.result.providerMetadata as AiUnknownObject | undefined
  return {
    schemaVersion: 1,
    provider: input.provider,
    modelId: input.modelId,
    text: input.result.text,
    reasoning: input.result.reasoningText || '',
    termination: projectTermination(input.result.finishReason, input.result.rawFinishReason),
    usage: projectUsage(input.result.usage, input.result.providerMetadata),
    response: {
      ...(input.result.response.id ? { id: input.result.response.id } : {}),
      ...(input.result.response.modelId ? { modelId: input.result.response.modelId } : {}),
      ...(input.result.response.timestamp
        ? { timestamp: input.result.response.timestamp.toISOString() }
        : {}),
    },
    ...(providerMetadata ? { providerMetadata } : {}),
  }
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`TASK_LLM_INVOCATION_RESULT_INVALID:${field}`)
  }
  return value
}

function parseOptionalNonNegativeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`TASK_LLM_INVOCATION_RESULT_INVALID:${field}`)
  }
  return value
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`TASK_LLM_INVOCATION_RESULT_INVALID:${field}`)
  return value
}

export function parseStoredAiLlmExecutionResult(value: unknown): AiLlmExecutionResult {
  if (!isRecord(value)) throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:root')
  if (value.schemaVersion !== 1) {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:schemaVersion')
  }
  if (typeof value.provider !== 'string' || !value.provider.trim()) {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:provider')
  }
  if (typeof value.modelId !== 'string' || !value.modelId.trim()) {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:modelId')
  }
  if (typeof value.text !== 'string' || typeof value.reasoning !== 'string') {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:content')
  }
  if (!isRecord(value.termination)) {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:termination')
  }
  const terminationKinds = new Set<AiLlmTermination['kind']>([
    'normal',
    'token_limit',
    'safety',
    'tool_call',
    'unknown',
  ])
  const terminationKind = value.termination.kind
  const rawReason = value.termination.rawReason
  if (
    typeof terminationKind !== 'string'
    || !terminationKinds.has(terminationKind as AiLlmTermination['kind'])
    || (rawReason !== null && typeof rawReason !== 'string')
  ) {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:termination')
  }
  if (!isRecord(value.usage)) throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:usage')
  if (!isRecord(value.response)) throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:response')
  if (value.providerMetadata !== undefined && !isRecord(value.providerMetadata)) {
    throw new Error('TASK_LLM_INVOCATION_RESULT_INVALID:providerMetadata')
  }

  const usage: AiLlmUsage = {
    promptTokens: parseNonNegativeInteger(value.usage.promptTokens, 'usage.promptTokens'),
    completionTokens: parseNonNegativeInteger(value.usage.completionTokens, 'usage.completionTokens'),
    totalTokens: parseNonNegativeInteger(value.usage.totalTokens, 'usage.totalTokens'),
  }
  const cachedInputTokens = parseOptionalNonNegativeNumber(value.usage.cachedInputTokens, 'usage.cachedInputTokens')
  const cacheWriteTokens = parseOptionalNonNegativeNumber(value.usage.cacheWriteTokens, 'usage.cacheWriteTokens')
  const cacheHitRate = parseOptionalNonNegativeNumber(value.usage.cacheHitRate, 'usage.cacheHitRate')
  const providerCostCredits = parseOptionalNonNegativeNumber(value.usage.providerCostCredits, 'usage.providerCostCredits')

  return {
    schemaVersion: 1,
    provider: value.provider,
    modelId: value.modelId,
    text: value.text,
    reasoning: value.reasoning,
    termination: {
      kind: terminationKind as AiLlmTermination['kind'],
      rawReason,
    },
    usage: {
      ...usage,
      ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
      ...(cacheHitRate !== undefined ? { cacheHitRate } : {}),
      ...(providerCostCredits !== undefined ? { providerCostCredits } : {}),
    },
    response: {
      ...(parseOptionalString(value.response.id, 'response.id') !== undefined
        ? { id: value.response.id as string }
        : {}),
      ...(parseOptionalString(value.response.modelId, 'response.modelId') !== undefined
        ? { modelId: value.response.modelId as string }
        : {}),
      ...(parseOptionalString(value.response.timestamp, 'response.timestamp') !== undefined
        ? { timestamp: value.response.timestamp as string }
        : {}),
    },
    ...(value.providerMetadata ? { providerMetadata: value.providerMetadata } : {}),
  }
}
