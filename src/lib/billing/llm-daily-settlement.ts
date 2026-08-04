import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { createScopedLogger } from '@/lib/logging/core'
import { calcTextWithCache } from './cost'
import { toChargeableCredits } from './credits'
import { planPoolDebit, usableCredits } from './credit-pools'
import { BUILTIN_PRICING_VERSION } from '@/lib/ai-registry/pricing-resolution'

const settlementLogger = createScopedLogger({ module: 'billing.llm-daily-settlement' })

/**
 * Daily settlement of language-model usage.
 *
 * A model call's price is only knowable after it runs, so LLM work cannot be
 * quoted and frozen the way media generation is. Charging each call separately
 * would also be wrong for the user: a day of assistant work is hundreds of
 * calls, and rounding every one up to a whole credit would cost far more than
 * the usage did. So usage is recorded exactly per call — that already happens,
 * as `UsageCost` rows — and billed once per user per day, rounded up a single
 * time.
 *
 * Only whole past days are settled. A day still in progress can still receive
 * rows, and settling it would either double-charge later arrivals or drop
 * them.
 */

/** Rows this settlement is responsible for. Media has its own freeze/settle path. */
const SETTLED_API_TYPE = 'text'

export interface LlmDailySettlementResult {
  readonly status: 'settled' | 'already_settled' | 'nothing_to_settle' | 'insufficient_balance'
  readonly credits: number
  readonly usageRows: number
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function formatUtcDay(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10)
}

function readTokenCount(metadata: Record<string, unknown>, field: string): number {
  const value = metadata[field]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
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

/**
 * Price one day of a user's recorded model usage.
 *
 * Each row is priced at the catalog's retail rate for its own model and token
 * counts — including the cache discount, because the recorded usage carries
 * how many input tokens were cache hits. Fractions accumulate across the day
 * and are rounded up once at the end.
 */
export function priceUsageRows(
  rows: ReadonlyArray<{ model: string; metadata: string | null }>,
): { credits: number; exactCredits: number } {
  let exact = 0
  for (const row of rows) {
    const metadata = parseMetadata(row.metadata)
    const inputTokens = readTokenCount(metadata, 'actualInputTokens')
    const outputTokens = readTokenCount(metadata, 'actualOutputTokens')
    const cachedInputTokens = readTokenCount(metadata, 'actualCachedInputTokens')
    if (inputTokens === 0 && outputTokens === 0) continue
    exact += calcTextWithCache(row.model, inputTokens, outputTokens, { cachedInputTokens })
  }
  return { credits: toChargeableCredits(exact), exactCredits: exact }
}

async function debitPoolsForSettlement(
  tx: Prisma.TransactionClient,
  input: { userId: string; credits: number; idempotencyKey: string; day: string; usageRows: number },
): Promise<LlmDailySettlementResult> {
  const balance = await tx.userBalance.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, balance: 0, frozenAmount: 0, totalSpent: 0 },
    update: {},
  })
  const now = new Date()
  const poolState = {
    rechargeCredits: balance.balance,
    subscriptionCredits: balance.subscriptionCredits,
    subscriptionExpiresAt: balance.subscriptionExpiresAt,
  }
  const split = planPoolDebit(poolState, input.credits, now)
  if (!split) {
    // The work is already done and the provider already paid. Recording the
    // debt would need a negative balance the ledger does not model, so the
    // shortfall is reported and the platform absorbs it — the pre-flight gate
    // is what stops a user reaching this state repeatedly.
    settlementLogger.error({
      audit: true,
      action: 'alert.billing.llm_settlement_uncovered',
      message: 'daily model usage exceeded available credits; platform absorbed the difference',
      userId: input.userId,
      details: {
        day: input.day,
        credits: input.credits,
        available: usableCredits(poolState, now),
        usageRows: input.usageRows,
      },
    })
    return { status: 'insufficient_balance', credits: input.credits, usageRows: input.usageRows }
  }

  const updated = await tx.userBalance.update({
    where: { userId: input.userId },
    data: {
      ...(split.recharge > 0 ? { balance: { decrement: split.recharge } } : {}),
      ...(split.subscription > 0
        ? { subscriptionCredits: { decrement: split.subscription } }
        : {}),
      totalSpent: { increment: input.credits },
    },
  })

  await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      type: 'consume',
      amount: -input.credits,
      balanceAfter: usableCredits(
        {
          rechargeCredits: updated.balance,
          subscriptionCredits: updated.subscriptionCredits,
          subscriptionExpiresAt: updated.subscriptionExpiresAt,
        },
        now,
      ),
      description: `[LLM] daily model usage ${input.day}`,
      taskType: 'llm_daily_usage',
      idempotencyKey: input.idempotencyKey,
      billingMeta: JSON.stringify({
        day: input.day,
        usageRows: input.usageRows,
        credits: input.credits,
        subscriptionCredits: split.subscription,
        rechargeCredits: split.recharge,
        pricingVersion: BUILTIN_PRICING_VERSION,
      }),
    },
  })

  return { status: 'settled', credits: input.credits, usageRows: input.usageRows }
}

/**
 * Settle one whole past day for one user.
 *
 * `(userId, 'consume', idempotencyKey)` is unique in the database, so a
 * concurrent or retried sweep settles the day once.
 */
export async function settleLlmUsageForDay(
  userId: string,
  day: Date,
): Promise<LlmDailySettlementResult> {
  const dayStart = startOfUtcDay(day)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const dayLabel = formatUtcDay(dayStart)
  const idempotencyKey = `llm-daily:${dayLabel}`

  const existing = await prisma.balanceTransaction.findFirst({
    where: { userId, type: 'consume', idempotencyKey },
    select: { id: true },
  })
  if (existing) return { status: 'already_settled', credits: 0, usageRows: 0 }

  const rows = await prisma.usageCost.findMany({
    where: {
      userId,
      apiType: SETTLED_API_TYPE,
      cost: 0,
      createdAt: { gte: dayStart, lt: dayEnd },
    },
    select: { model: true, metadata: true },
  })
  if (rows.length === 0) return { status: 'nothing_to_settle', credits: 0, usageRows: 0 }

  const priced = priceUsageRows(rows)
  if (priced.credits === 0) return { status: 'nothing_to_settle', credits: 0, usageRows: rows.length }

  try {
    return await prisma.$transaction(async (tx) => debitPoolsForSettlement(tx, {
      userId,
      credits: priced.credits,
      idempotencyKey,
      day: dayLabel,
      usageRows: rows.length,
    }))
  } catch (error) {
    // The unique key is the real guard against double charging; losing the
    // race is a success for the day, not a failure.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { status: 'already_settled', credits: 0, usageRows: rows.length }
    }
    throw error
  }
}

/**
 * Settle every user with unsettled model usage in the days before today.
 *
 * Days are settled oldest first so a user who has been away for a week is
 * charged day by day, exactly as if they had been settled on time.
 */
export async function settleDueLlmUsage(
  now: Date = new Date(),
  maxDaysBack = 7,
): Promise<{ users: number; settledDays: number; credits: number }> {
  const today = startOfUtcDay(now)
  const oldest = new Date(today.getTime() - maxDaysBack * 24 * 60 * 60 * 1000)

  const users = await prisma.usageCost.findMany({
    where: {
      apiType: SETTLED_API_TYPE,
      cost: 0,
      createdAt: { gte: oldest, lt: today },
    },
    distinct: ['userId'],
    select: { userId: true },
  })

  let settledDays = 0
  let credits = 0
  for (const { userId } of users) {
    for (let offset = maxDaysBack; offset >= 1; offset -= 1) {
      const day = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000)
      const result = await settleLlmUsageForDay(userId, day)
      if (result.status === 'settled') {
        settledDays += 1
        credits += result.credits
      }
    }
  }

  settlementLogger.info({
    action: 'billing.llm_daily_settlement.completed',
    message: 'daily model usage settlement completed',
    details: { users: users.length, settledDays, credits },
  })

  return { users: users.length, settledDays, credits }
}
