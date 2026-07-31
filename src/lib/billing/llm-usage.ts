import type { Usage } from '@openai/agents'
import type { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AiLlmUsage } from '@/lib/ai-registry/types'
import { recordUsageFact } from './reporting'

export const llmUsageFactSchema = z
  .object({
    phase: z.enum(['agent_model', 'context_compaction', 'creative_worker']),
    modelKey: z.string().trim().min(1).max(191),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    requestCount: z.number().int().nonnegative(),
  })
  .strict()

export type LlmUsageFact = z.infer<typeof llmUsageFactSchema>

export function buildLlmUsageFactId(
  scope: 'agent-turn' | 'creative-work',
  identityParts: readonly (string | number)[],
): string {
  const canonicalIdentity = identityParts
    .map((part) => {
      const value = String(part)
      return `${Buffer.byteLength(value, 'utf8')}:${value}`
    })
    .join('|')
  const digest = createHash('sha256').update(canonicalIdentity).digest('hex')
  return `llm-usage:v1:${scope}:${digest}`
}

function normalizeTokenCount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0
}

function readAgentsCachedInputTokens(usage: Usage): number {
  const details = usage.requestUsageEntries
    ? usage.requestUsageEntries.map((entry) => entry.inputTokensDetails)
    : usage.inputTokensDetails
  return details.reduce((total, entry) => {
    const value = entry.cached_tokens
    return total + normalizeTokenCount(value)
  }, 0)
}

export function projectAgentsSdkUsage(params: {
  phase: 'agent_model' | 'creative_worker'
  modelKey: string
  usage: Usage
}): LlmUsageFact {
  return llmUsageFactSchema.parse({
    phase: params.phase,
    modelKey: params.modelKey,
    inputTokens: normalizeTokenCount(params.usage.inputTokens),
    outputTokens: normalizeTokenCount(params.usage.outputTokens),
    cachedInputTokens: readAgentsCachedInputTokens(params.usage),
    requestCount: normalizeTokenCount(params.usage.requests),
  })
}

export function projectAiLlmUsage(params: {
  phase: 'context_compaction'
  modelKey: string
  usage: AiLlmUsage
}): LlmUsageFact {
  return llmUsageFactSchema.parse({
    phase: params.phase,
    modelKey: params.modelKey,
    inputTokens: normalizeTokenCount(params.usage.promptTokens),
    outputTokens: normalizeTokenCount(params.usage.completionTokens),
    cachedInputTokens: normalizeTokenCount(params.usage.cachedInputTokens),
    requestCount: 1,
  })
}

export async function recordLlmUsageFact(
  tx: Prisma.TransactionClient,
  params: {
    usageId: string
    projectId: string
    userId: string
    action: string
    usage: LlmUsageFact
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const usage = llmUsageFactSchema.parse(params.usage)
  const quantity = usage.inputTokens + usage.outputTokens
  if (quantity === 0 && usage.requestCount === 0) return
  await recordUsageFact(tx, {
    usageId: params.usageId,
    projectId: params.projectId,
    userId: params.userId,
    action: params.action,
    apiType: 'text',
    model: usage.modelKey,
    quantity,
    unit: 'token',
    cost: 0,
    metadata: {
      usagePhase: usage.phase,
      requestCount: usage.requestCount,
      actualInputTokens: usage.inputTokens,
      actualOutputTokens: usage.outputTokens,
      actualCachedInputTokens: usage.cachedInputTokens,
      ...params.metadata,
    },
  })
}
