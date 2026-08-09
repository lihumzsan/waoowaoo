import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { settleRealtimeLlmUsage } from '@/lib/billing/llm-realtime-settlement'
import { BillingOperationError } from '@/lib/billing/errors'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION
const originalProviderCredentialMode = process.env.PROVIDER_CREDENTIAL_MODE
const originalBillingMode = process.env.BILLING_MODE

const usage = {
  phase: 'agent_model' as const,
  modelKey: 'openrouter::openai/gpt-test',
  inputTokens: 120,
  outputTokens: 30,
  cachedInputTokens: 20,
  requestCount: 1,
  toolCalls: 0,
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function settle(input: {
  usageId: string
  userId: string
  projectId: string
  exactRetailCredits: number
  outputTokens?: number
}) {
  return await settleRealtimeLlmUsage({
    usageId: input.usageId,
    userId: input.userId,
    projectId: input.projectId,
    action: 'assistant.run',
    usage: { ...usage, outputTokens: input.outputTokens ?? usage.outputTokens },
    exactRetailCredits: input.exactRetailCredits,
    pricingSource: 'openrouter_reported_cost',
    metadata: { turnId: 'turn-realtime-test' },
  })
}

describe('billing/LLM realtime settlement integration', () => {
  beforeEach(async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'
    await resetBillingState()
  })

  afterAll(() => {
    restoreEnvironment('DEPLOYMENT_EDITION', originalDeploymentEdition)
    restoreEnvironment('PROVIDER_CREDENTIAL_MODE', originalProviderCredentialMode)
    restoreEnvironment('BILLING_MODE', originalBillingMode)
  })

  it('carries fractional user prices across calls without rounding every call up', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const results = []
    for (let index = 0; index < 3; index += 1) {
      results.push(await settle({
        usageId: `llm-realtime-fraction-${String(index)}`,
        userId: user.id,
        projectId: project.id,
        exactRetailCredits: 0.4,
      }))
    }

    expect(results.map((result) => result.chargedCredits)).toEqual([1, 0, 1])
    const balance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })
    expect(balance.balance).toBe(8)
    expect(balance.totalSpent).toBe(2)

    const exact = await prisma.usageCost.aggregate({
      where: { userId: user.id },
      _sum: { cost: true, chargedCredits: true },
    })
    expect(Number(exact._sum.cost)).toBe(1.2)
    expect(exact._sum.chargedCredits).toBe(2)

    const meter = await prisma.llmBillingMeter.findUniqueOrThrow({ where: { userId: user.id } })
    expect(meter.totalRetailMicrocredits).toBe(BigInt(1_200_000))
    expect(meter.totalChargedCredits).toBe(2)
    expect(meter.prepaidMicrocredits).toBe(BigInt(800_000))
  })

  it('replays one generation exactly once and rejects a divergent replay', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)
    const input = {
      usageId: 'llm-realtime-replay',
      userId: user.id,
      projectId: project.id,
      exactRetailCredits: 0.4,
    }

    expect((await settle(input)).status).toBe('settled')
    expect((await settle(input)).status).toBe('already_settled')
    expect(await prisma.usageCost.count({ where: { id: input.usageId } })).toBe(1)
    expect(await prisma.balanceTransaction.count({ where: { userId: user.id } })).toBe(1)

    await expect(settle({ ...input, outputTokens: 31 })).rejects.toMatchObject({
      code: 'BILLING_USAGE_REPLAY_DIVERGED',
    } satisfies Partial<BillingOperationError>)
  })

  it('serializes concurrent generations against one user meter', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 100)

    await Promise.all(Array.from({ length: 10 }, async (_, index) => await settle({
      usageId: `llm-realtime-concurrent-${String(index)}`,
      userId: user.id,
      projectId: project.id,
      exactRetailCredits: 0.2,
    })))

    const balance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })
    expect(balance.balance).toBe(98)
    expect(balance.totalSpent).toBe(2)
    expect(await prisma.usageCost.count({ where: { userId: user.id } })).toBe(10)
    expect(await prisma.balanceTransaction.aggregate({
      where: { userId: user.id },
      _sum: { amount: true },
    })).toMatchObject({ _sum: { amount: -2 } })
  })

  it('uses subscription credits first and records uncovered usage without debt', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await prisma.userBalance.create({
      data: {
        userId: user.id,
        balance: 1,
        subscriptionCredits: 2,
        subscriptionExpiresAt: new Date(Date.now() + 60_000),
        frozenAmount: 0,
        totalSpent: 0,
      },
    })

    const covered = await settle({
      usageId: 'llm-realtime-pools',
      userId: user.id,
      projectId: project.id,
      exactRetailCredits: 2.4,
    })
    expect(covered.chargedCredits).toBe(3)
    expect(covered.uncoveredMicrocredits).toBe(BigInt(0))
    const coveredBalance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })
    expect(coveredBalance.subscriptionCredits).toBe(0)
    expect(coveredBalance.balance).toBe(0)

    const uncovered = await settle({
      usageId: 'llm-realtime-uncovered',
      userId: user.id,
      projectId: project.id,
      exactRetailCredits: 1.4,
    })
    expect(uncovered.chargedCredits).toBe(0)
    expect(uncovered.uncoveredMicrocredits).toBe(BigInt(800_000))
    const finalBalance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })
    expect(finalBalance.balance).toBe(0)
    expect(finalBalance.subscriptionCredits).toBe(0)
  })
})
