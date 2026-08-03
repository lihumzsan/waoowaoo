import { beforeEach, describe, expect, it } from 'vitest'
import { calcTextWithCache } from '@/lib/billing/cost'
import { toChargeableCredits } from '@/lib/billing/credits'
import { settleLlmUsageForDay } from '@/lib/billing/llm-daily-settlement'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

/**
 * The oracle is the ledger: whether a day of recorded model usage produced
 * exactly one charge, of the amount the catalog prices that usage at, and
 * whether re-running the settlement can produce a second one.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MODEL = 'openrouter::anthropic/claude-sonnet-4.6'

function utcDay(offsetDays: number): Date {
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return new Date(today.getTime() + offsetDays * DAY_MS)
}

async function recordUsage(input: {
  userId: string
  projectId: string
  createdAt: Date
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  suffix: string
}) {
  await prisma.usageCost.create({
    data: {
      id: `usage-${input.suffix}`,
      userId: input.userId,
      projectId: input.projectId,
      apiType: 'text',
      model: MODEL,
      action: 'assistant_turn',
      quantity: input.inputTokens + input.outputTokens,
      unit: 'token',
      cost: 0,
      createdAt: input.createdAt,
      metadata: JSON.stringify({
        actualInputTokens: input.inputTokens,
        actualOutputTokens: input.outputTokens,
        actualCachedInputTokens: input.cachedInputTokens ?? 0,
      }),
    },
  })
}

describe('billing/llm daily settlement integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('charges a whole past day once, at the catalog price of its recorded usage', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 100_000)
    const yesterday = utcDay(-1)

    await recordUsage({
      userId: user.id,
      projectId: project.id,
      createdAt: new Date(yesterday.getTime() + 3600_000),
      inputTokens: 40_000,
      outputTokens: 2_000,
      suffix: 'a',
    })
    await recordUsage({
      userId: user.id,
      projectId: project.id,
      createdAt: new Date(yesterday.getTime() + 7200_000),
      inputTokens: 10_000,
      outputTokens: 500,
      cachedInputTokens: 8_000,
      suffix: 'b',
    })

    // Fractions accumulate across the day and round up once, rather than each
    // call rounding up on its own.
    const expected = toChargeableCredits(
      calcTextWithCache(MODEL, 40_000, 2_000, { cachedInputTokens: 0 })
      + calcTextWithCache(MODEL, 10_000, 500, { cachedInputTokens: 8_000 }),
    )

    const result = await settleLlmUsageForDay(user.id, yesterday)
    expect(result).toMatchObject({ status: 'settled', credits: expected, usageRows: 2 })

    const balance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })
    expect(balance.balance).toBe(100_000 - expected)
    expect(balance.totalSpent).toBe(expected)

    const charges = await prisma.balanceTransaction.findMany({
      where: { userId: user.id, type: 'consume' },
    })
    expect(charges).toHaveLength(1)
    expect(charges[0].amount).toBe(-expected)
  })

  it('is idempotent: settling the same day again does not charge twice', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 100_000)
    const yesterday = utcDay(-1)
    await recordUsage({
      userId: user.id,
      projectId: project.id,
      createdAt: new Date(yesterday.getTime() + 3600_000),
      inputTokens: 40_000,
      outputTokens: 2_000,
      suffix: 'once',
    })

    const first = await settleLlmUsageForDay(user.id, yesterday)
    expect(first.status).toBe('settled')
    const balanceAfterFirst = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })

    const second = await settleLlmUsageForDay(user.id, yesterday)
    expect(second.status).toBe('already_settled')

    const balanceAfterSecond = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })
    expect(balanceAfterSecond.balance).toBe(balanceAfterFirst.balance)
    expect(await prisma.balanceTransaction.count({
      where: { userId: user.id, type: 'consume' },
    })).toBe(1)
  })

  it('drains the subscription pool before touching permanent credits', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await prisma.userBalance.create({
      data: {
        userId: user.id,
        balance: 100_000,
        subscriptionCredits: 10,
        subscriptionExpiresAt: new Date(Date.now() + DAY_MS),
        frozenAmount: 0,
        totalSpent: 0,
      },
    })
    const yesterday = utcDay(-1)
    await recordUsage({
      userId: user.id,
      projectId: project.id,
      createdAt: new Date(yesterday.getTime() + 3600_000),
      inputTokens: 40_000,
      outputTokens: 2_000,
      suffix: 'pool',
    })

    const result = await settleLlmUsageForDay(user.id, yesterday)
    expect(result.status).toBe('settled')

    // The day costs more than the subscription pool holds, so the pool is
    // emptied first and only the remainder comes out of bought credits.
    expect(result.credits).toBeGreaterThan(10)
    const balance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })
    expect(balance.subscriptionCredits).toBe(0)
    expect(balance.balance).toBe(100_000 - (result.credits - 10))
  })

  it('leaves today alone, because more usage can still arrive', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 100_000)
    await recordUsage({
      userId: user.id,
      projectId: project.id,
      createdAt: new Date(),
      inputTokens: 40_000,
      outputTokens: 2_000,
      suffix: 'today',
    })

    const result = await settleLlmUsageForDay(user.id, utcDay(-1))
    expect(result.status).toBe('nothing_to_settle')
    expect(await prisma.balanceTransaction.count({ where: { userId: user.id } })).toBe(0)
  })
})
