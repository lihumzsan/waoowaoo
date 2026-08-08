import { Prisma } from '@prisma/client'
import {
  getDeploymentConfig,
  isCloudDeployment,
  isPlatformProviderCredentialMode,
} from '@/lib/deployment/config'
import { prisma } from '@/lib/prisma'
import { BUILTIN_PRICING_VERSION } from '@/lib/ai-registry/pricing-resolution'
import { BillingOperationError } from './errors'
import { consumeAvailableCreditsInTransaction } from './ledger'
import { llmUsageFactSchema, type LlmUsageFact } from './llm-usage'
import { getBillingMode } from './mode'
import { toMoneyNumber } from './money'
import { recordUsageFact } from './reporting'

const ZERO_MICROCREDITS = BigInt(0)
const MICROCREDITS_PER_CREDIT = BigInt(1_000_000)

type LockedLlmBillingMeter = {
  prepaidMicrocredits: bigint
  totalRetailMicrocredits: bigint
  totalChargedCredits: number
  totalUncoveredMicrocredits: bigint
}

export type RealtimeLlmSettlementResult = {
  readonly status: 'settled' | 'already_settled' | 'ignored'
  readonly exactRetailCredits: number
  readonly chargedCredits: number
  readonly uncoveredMicrocredits: bigint
}

function toMicrocredits(exactRetailCredits: number): bigint {
  if (!Number.isFinite(exactRetailCredits) || exactRetailCredits < 0) {
    throw new BillingOperationError('BILLING_INVALID_CHARGED_AMOUNT', 'LLM retail cost is invalid', {
      exactRetailCredits,
    })
  }
  const rounded = Math.round(exactRetailCredits * Number(MICROCREDITS_PER_CREDIT))
  if (!Number.isSafeInteger(rounded)) {
    throw new BillingOperationError('BILLING_INVALID_CHARGED_AMOUNT', 'LLM retail cost exceeds the safe range', {
      exactRetailCredits,
    })
  }
  return BigInt(rounded)
}

function fromMicrocredits(value: bigint): number {
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric)) {
    throw new BillingOperationError('BILLING_INVALID_CHARGED_AMOUNT', 'LLM microcredit amount exceeds the safe range')
  }
  return numeric / Number(MICROCREDITS_PER_CREDIT)
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function assertReplayMatches(input: {
  existing: {
    projectId: string
    userId: string
    apiType: string
    model: string
    action: string
    quantity: number
    unit: string
    cost: Prisma.Decimal
    metadata: string | null
  }
  usageId: string
  projectId: string
  userId: string
  action: string
  usage: LlmUsageFact
  exactRetailCredits: number
  metadata?: Record<string, unknown>
}): void {
  const quantity = input.usage.inputTokens + input.usage.outputTokens
  const persistedMetadata = parseMetadata(input.existing.metadata)
  const metadataMatches = Object.entries(input.metadata ?? {}).every(([key, value]) => (
    JSON.stringify(persistedMetadata[key] ?? null) === JSON.stringify(value ?? null)
  ))
  if (
    input.existing.projectId !== input.projectId
    || input.existing.userId !== input.userId
    || input.existing.apiType !== 'text'
    || input.existing.model !== input.usage.modelKey
    || input.existing.action !== input.action
    || input.existing.quantity !== quantity
    || input.existing.unit !== 'token'
    || toMoneyNumber(input.existing.cost) !== input.exactRetailCredits
    || !metadataMatches
  ) {
    throw new BillingOperationError(
      'BILLING_USAGE_REPLAY_DIVERGED',
      'realtime LLM usage replay diverged from the persisted identity',
      { usageId: input.usageId },
    )
  }
}

async function lockMeter(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<LockedLlmBillingMeter> {
  const rows = await tx.$queryRaw<LockedLlmBillingMeter[]>`
    SELECT prepaidMicrocredits, totalRetailMicrocredits,
           totalChargedCredits, totalUncoveredMicrocredits
    FROM llm_billing_meters
    WHERE userId = ${userId}
    FOR UPDATE
  `
  const meter = rows[0]
  if (!meter) {
    throw new BillingOperationError('BILLING_BALANCE_NOT_FOUND', 'LLM billing meter missing after initialization', {
      userId,
    })
  }
  return meter
}

async function ensureMeter(userId: string): Promise<void> {
  try {
    await prisma.llmBillingMeter.create({ data: { userId } })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
    ) return
    throw error
  }
}

/**
 * Settle one cloud LLM usage fact immediately.
 *
 * Exact retail stays on UsageCost. The user balance remains integer-only, so
 * previously charged sub-credit coverage is carried across generations and
 * only the newly crossed whole-credit delta reaches the ledger.
 */
export async function settleRealtimeLlmUsage(input: {
  usageId: string
  projectId: string
  userId: string
  action: string
  usage: LlmUsageFact
  exactRetailCredits: number
  pricingSource: 'openrouter_reported_cost' | 'catalog_usage'
  metadata?: Record<string, unknown>
}): Promise<RealtimeLlmSettlementResult> {
  const deployment = getDeploymentConfig()
  if (
    !isCloudDeployment(deployment)
    || !isPlatformProviderCredentialMode(deployment)
    || await getBillingMode() !== 'ENFORCE'
  ) {
    return {
      status: 'ignored',
      exactRetailCredits: input.exactRetailCredits,
      chargedCredits: 0,
      uncoveredMicrocredits: ZERO_MICROCREDITS,
    }
  }
  const usage = llmUsageFactSchema.parse(input.usage)
  const exactMicrocredits = toMicrocredits(input.exactRetailCredits)
  const exactRetailCredits = fromMicrocredits(exactMicrocredits)
  // A zero-valued meter is safe to create before the settlement transaction.
  // This short autocommit step turns first-use concurrency into a unique-key
  // winner/loser, after which every settlement serializes on the same row.
  await ensureMeter(input.userId)

  return await prisma.$transaction(async (tx) => {
    const meter = await lockMeter(tx, input.userId)
    const existing = await tx.usageCost.findUnique({ where: { id: input.usageId } })
    if (existing) {
      assertReplayMatches({
        existing,
        usageId: input.usageId,
        projectId: input.projectId,
        userId: input.userId,
        action: input.action,
        usage,
        exactRetailCredits,
        metadata: input.metadata,
      })
      const existingMetadata = parseMetadata(existing.metadata)
      const uncovered = existingMetadata.uncoveredMicrocredits
      return {
        status: 'already_settled',
        exactRetailCredits,
        chargedCredits: existing.chargedCredits,
        uncoveredMicrocredits: typeof uncovered === 'number' && Number.isSafeInteger(uncovered)
          ? BigInt(uncovered)
          : ZERO_MICROCREDITS,
      }
    }

    const uncoveredBeforeDebit = exactMicrocredits > meter.prepaidMicrocredits
      ? exactMicrocredits - meter.prepaidMicrocredits
      : ZERO_MICROCREDITS
    const requiredCredits = uncoveredBeforeDebit === ZERO_MICROCREDITS
      ? 0
      : Number((uncoveredBeforeDebit + MICROCREDITS_PER_CREDIT - BigInt(1)) / MICROCREDITS_PER_CREDIT)
    const debit = requiredCredits > 0
      ? await consumeAvailableCreditsInTransaction(tx, {
          userId: input.userId,
          requiredCredits,
          idempotencyKey: `llm-realtime:${input.usageId}`,
          projectId: input.projectId,
          action: input.action,
          apiType: 'text',
          model: usage.modelKey,
          quantity: usage.inputTokens + usage.outputTokens,
          unit: 'token',
          metadata: {
            actualInputTokens: usage.inputTokens,
            actualOutputTokens: usage.outputTokens,
            actualCachedInputTokens: usage.cachedInputTokens,
            actualCacheWriteTokens: usage.cacheWriteTokens ?? 0,
            actualToolCalls: usage.toolCalls,
            exactRetailCredits,
            pricingVersion: BUILTIN_PRICING_VERSION,
            pricingSource: input.pricingSource,
            ...(input.metadata ?? {}),
          },
        })
      : { chargedCredits: 0, balanceAfter: 0 }
    const coveredMicrocredits = BigInt(debit.chargedCredits) * MICROCREDITS_PER_CREDIT
    const uncoveredMicrocredits = uncoveredBeforeDebit > coveredMicrocredits
      ? uncoveredBeforeDebit - coveredMicrocredits
      : ZERO_MICROCREDITS
    const prepaidMicrocredits = exactMicrocredits <= meter.prepaidMicrocredits
      ? meter.prepaidMicrocredits - exactMicrocredits
      : coveredMicrocredits > uncoveredBeforeDebit
        ? coveredMicrocredits - uncoveredBeforeDebit
        : ZERO_MICROCREDITS

    await recordUsageFact(tx, {
      usageId: input.usageId,
      projectId: input.projectId,
      userId: input.userId,
      action: input.action,
      apiType: 'text',
      model: usage.modelKey,
      quantity: usage.inputTokens + usage.outputTokens,
      unit: 'token',
      cost: exactRetailCredits,
      chargedCredits: debit.chargedCredits,
      metadata: {
        usagePhase: usage.phase,
        requestCount: usage.requestCount,
        actualInputTokens: usage.inputTokens,
        actualOutputTokens: usage.outputTokens,
        actualCachedInputTokens: usage.cachedInputTokens,
        actualCacheWriteTokens: usage.cacheWriteTokens ?? 0,
        actualToolCalls: usage.toolCalls,
        exactRetailCredits,
        chargedCredits: debit.chargedCredits,
        uncoveredMicrocredits: Number(uncoveredMicrocredits),
        pricingVersion: BUILTIN_PRICING_VERSION,
        pricingSource: input.pricingSource,
        ...(input.metadata ?? {}),
      },
    })
    await tx.llmBillingMeter.update({
      where: { userId: input.userId },
      data: {
        prepaidMicrocredits,
        totalRetailMicrocredits: { increment: exactMicrocredits },
        totalChargedCredits: { increment: debit.chargedCredits },
        totalUncoveredMicrocredits: { increment: uncoveredMicrocredits },
      },
    })
    return {
      status: 'settled',
      exactRetailCredits,
      chargedCredits: debit.chargedCredits,
      uncoveredMicrocredits,
    }
  }, { maxWait: 10_000, timeout: 10_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
}
