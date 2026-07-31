import type { Prisma } from '@prisma/client'
import {
  buildLlmUsageFactId,
  llmUsageFactSchema,
  recordLlmUsageFact,
  type LlmUsageFact,
} from '@/lib/billing/llm-usage'
import { prisma } from '@/lib/prisma'

export async function recordAgentTurnUsageFactsInTransaction(params: {
  tx: Prisma.TransactionClient
  turnId: string
  attempt: number
  projectId: string
  userId: string
  usageFacts: readonly LlmUsageFact[]
}): Promise<void> {
  if (!Number.isSafeInteger(params.attempt) || params.attempt < 1) {
    throw new Error(`AGENT_TURN_USAGE_ATTEMPT_INVALID:${params.turnId}`)
  }
  const parsed = params.usageFacts.map((fact) => llmUsageFactSchema.parse(fact))
  if (new Set(parsed.map((fact) => fact.phase)).size !== parsed.length) {
    throw new Error(`AGENT_TURN_USAGE_PHASE_DUPLICATE:${params.turnId}`)
  }
  for (const usage of parsed) {
    await recordLlmUsageFact(params.tx, {
      usageId: buildLlmUsageFactId('agent-turn', [params.turnId, params.attempt, usage.phase]),
      projectId: params.projectId,
      userId: params.userId,
      action: 'assistant.run',
      usage,
      metadata: {
        turnId: params.turnId,
        attempt: params.attempt,
      },
    })
  }
}

export async function recordObservedAgentTurnUsageFacts(params: {
  turnId: string
  attempt: number
  projectId: string
  userId: string
  usageFacts: readonly LlmUsageFact[]
}): Promise<void> {
  if (params.usageFacts.length === 0) return
  await prisma.$transaction(async (tx) => {
    await recordAgentTurnUsageFactsInTransaction({
      tx,
      turnId: params.turnId,
      attempt: params.attempt,
      projectId: params.projectId,
      userId: params.userId,
      usageFacts: params.usageFacts,
    })
  })
}
