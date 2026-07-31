import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { calcMusic } from '@/lib/billing/cost'
import { PLATFORM_VOICE_DESIGN_MODEL_KEY } from '@/lib/ai-registry/voice-design-contract'
import { buildDefaultTaskBillingInfo } from '@/lib/billing/task-policy'
import {
  prepareTaskBillingInTransaction,
  rollbackTaskBillingInTransaction,
  settleTaskBillingInTransaction,
} from '@/lib/billing/service'
import { BillingOperationError } from '@/lib/billing/errors'
import { buildLlmUsageFactId, recordLlmUsageFact } from '@/lib/billing/llm-usage'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

function expectBillableInfo(
  info: TaskBillingInfo | null | undefined,
): Extract<TaskBillingInfo, { billable: true }> {
  expect(info?.billable).toBe(true)
  if (!info || !info.billable) {
    throw new Error('Expected billable task billing info')
  }
  return info
}

describe('billing/service integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('marks task billing as skipped in OFF mode', async () => {
    process.env.BILLING_MODE = 'OFF'
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const info = buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_AUDIO, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 5,
    })!
    const result = await prisma.$transaction(
      async (tx) =>
        await prepareTaskBillingInTransaction(
          tx,
          {
            id: randomUUID(),
            userId: user.id,
            projectId: project.id,
            billingInfo: info,
          },
          'OFF',
        ),
    )

    expect(result?.billable).toBe(true)
    expect((result as TaskBillingInfo & { status: string }).status).toBe('skipped')
  })

  it('records shadow audit in SHADOW mode and does not consume balance', async () => {
    process.env.BILLING_MODE = 'SHADOW'
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const info = buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_AUDIO, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 5,
    })!
    const taskId = randomUUID()
    const prepared = expectBillableInfo(
      await prisma.$transaction(
        async (tx) =>
          await prepareTaskBillingInTransaction(
            tx,
            {
              id: taskId,
              userId: user.id,
              projectId: project.id,
              billingInfo: info,
            },
            'SHADOW',
          ),
      ),
    )

    expect(prepared.status).toBe('quoted')

    const settled = expectBillableInfo(
      await prisma.$transaction(
        async (tx) =>
          await settleTaskBillingInTransaction(
            tx,
            {
              id: taskId,
              userId: user.id,
              projectId: project.id,
              billingInfo: prepared,
            },
            {
              result: { actualDurationSeconds: 2 },
            },
          ),
      ),
    )

    expect(settled.status).toBe('settled')
    expect(settled.chargedCost).toBe(0)

    const balance = await prisma.userBalance.findUnique({ where: { userId: user.id } })
    expect(balance?.balance).toBeCloseTo(10, 8)
    expect(balance?.totalSpent).toBeCloseTo(0, 8)
    expect(await prisma.balanceTransaction.count({ where: { type: 'shadow_consume' } })).toBe(1)
  })

  it('exact-replays free LLM usage by canonical row identity and rejects divergent usage', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const usageId = buildLlmUsageFactId('agent-turn', ['turn-usage-test', 1, 'agent_model'])
    const usage = {
      phase: 'agent_model' as const,
      modelKey: 'openai::usage-test-model',
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 20,
      requestCount: 1,
    }

    const record = async (outputTokens = usage.outputTokens) => {
      await prisma.$transaction(async (tx) => {
        await recordLlmUsageFact(tx, {
          usageId,
          projectId: project.id,
          userId: user.id,
          action: 'assistant.run',
          usage: { ...usage, outputTokens },
          metadata: { turnId: 'turn-usage-test', attempt: 1 },
        })
      })
    }

    await record()
    await record()

    const facts = await prisma.usageCost.findMany({ where: { id: usageId } })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      quantity: 150,
      unit: 'token',
      action: 'assistant.run',
      model: usage.modelKey,
    })
    expect(facts[0]!.cost.toNumber()).toBe(0)
    expect(await prisma.balanceTransaction.count()).toBe(0)

    await expect(record(31)).rejects.toMatchObject({
      code: 'BILLING_USAGE_REPLAY_DIVERGED',
    } satisfies Partial<BillingOperationError>)
    expect(await prisma.usageCost.count({ where: { id: usageId } })).toBe(1)
  })

  it('freezes and settles in ENFORCE mode with actual usage', async () => {
    process.env.BILLING_MODE = 'ENFORCE'
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const info = buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_AUDIO, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 5,
    })!
    const taskId = randomUUID()
    const prepared = expectBillableInfo(
      await prisma.$transaction(
        async (tx) =>
          await prepareTaskBillingInTransaction(
            tx,
            {
              id: taskId,
              userId: user.id,
              projectId: project.id,
              billingInfo: info,
            },
            'ENFORCE',
          ),
      ),
    )

    expect(prepared.status).toBe('frozen')
    expect(prepared.freezeId).toBeTruthy()

    const settled = expectBillableInfo(
      await prisma.$transaction(
        async (tx) =>
          await settleTaskBillingInTransaction(
            tx,
            {
              id: taskId,
              userId: user.id,
              projectId: project.id,
              billingInfo: prepared,
            },
            {
              result: { actualDurationSeconds: 2 },
            },
          ),
      ),
    )

    expect(settled.status).toBe('settled')
    expect(settled.chargedCost).toBeCloseTo(calcMusic('google::lyria-3-pro-preview', 1), 8)

    const balance = await prisma.userBalance.findUnique({ where: { userId: user.id } })
    expect(balance?.totalSpent).toBeCloseTo(calcMusic('google::lyria-3-pro-preview', 1), 8)
    expect(balance?.frozenAmount).toBeCloseTo(0, 8)
  })

  it('settles provider overage at the immutable approved ceiling without requiring later balance', async () => {
    process.env.BILLING_MODE = 'ENFORCE'
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const info = expectBillableInfo(
      buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_VOICE, {
        voiceModel: PLATFORM_VOICE_DESIGN_MODEL_KEY,
        previewText: 'a',
      }),
    )
    await seedBalance(user.id, info.maxFrozenCost)

    const taskId = randomUUID()
    const prepared = expectBillableInfo(
      await prisma.$transaction(
        async (tx) =>
          await prepareTaskBillingInTransaction(
            tx,
            {
              id: taskId,
              userId: user.id,
              projectId: project.id,
              billingInfo: info,
            },
            'ENFORCE',
          ),
      ),
    )
    const settled = expectBillableInfo(
      await prisma.$transaction(
        async (tx) =>
          await settleTaskBillingInTransaction(
            tx,
            {
              id: taskId,
              userId: user.id,
              projectId: project.id,
              billingInfo: prepared,
            },
            { result: { actualCharacters: 10_000 } },
          ),
      ),
    )

    expect(settled.status).toBe('settled')
    expect(settled.chargedCost).toBeCloseTo(info.maxFrozenCost, 8)
    const [balance, freeze] = await Promise.all([
      prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } }),
      prisma.balanceFreeze.findUniqueOrThrow({
        where: { id: prepared.freezeId! },
      }),
    ])
    expect(balance.balance.toNumber()).toBeCloseTo(0, 8)
    expect(balance.frozenAmount.toNumber()).toBeCloseTo(0, 8)
    expect(balance.totalSpent.toNumber()).toBeCloseTo(info.maxFrozenCost, 8)
    expect(freeze.status).toBe('confirmed')
    expect(freeze.amount.toNumber()).toBeCloseTo(info.maxFrozenCost, 8)
  })

  it('rejects zero quoted task cost in ENFORCE mode instead of skipping billing', async () => {
    process.env.BILLING_MODE = 'ENFORCE'
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const info: Extract<TaskBillingInfo, { billable: true }> = {
      billable: true,
      source: 'task',
      taskType: TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
      apiType: 'music',
      model: 'google::lyria-3-pro-preview',
      quantity: 0,
      unit: 'call',
      maxFrozenCost: 0,
      action: TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
      status: 'quoted',
    }

    await expect(
      prisma.$transaction(
        async (tx) =>
          await prepareTaskBillingInTransaction(
            tx,
            {
              id: randomUUID(),
              userId: user.id,
              projectId: project.id,
              billingInfo: info,
            },
            'ENFORCE',
          ),
      ),
    ).rejects.toMatchObject({
      code: 'BILLING_INVALID_CHARGED_AMOUNT',
    } satisfies Partial<BillingOperationError>)

    const balance = await prisma.userBalance.findUnique({ where: { userId: user.id } })
    expect(balance?.balance).toBeCloseTo(10, 8)
    expect(await prisma.balanceFreeze.count()).toBe(0)
  })

  it('rolls back frozen billing in ENFORCE mode', async () => {
    process.env.BILLING_MODE = 'ENFORCE'
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const info = buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_AUDIO, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 5,
    })!
    const taskId = randomUUID()
    const prepared = expectBillableInfo(
      await prisma.$transaction(
        async (tx) =>
          await prepareTaskBillingInTransaction(
            tx,
            {
              id: taskId,
              userId: user.id,
              projectId: project.id,
              billingInfo: info,
            },
            'ENFORCE',
          ),
      ),
    )

    const rolled = expectBillableInfo(
      await prisma.$transaction(
        async (tx) =>
          await rollbackTaskBillingInTransaction(tx, {
            id: taskId,
            userId: user.id,
            billingInfo: prepared,
          }),
      ),
    )

    expect(rolled.status).toBe('rolled_back')
    const balance = await prisma.userBalance.findUnique({ where: { userId: user.id } })
    expect(balance?.balance).toBeCloseTo(10, 8)
    expect(balance?.frozenAmount).toBeCloseTo(0, 8)
  })
})
