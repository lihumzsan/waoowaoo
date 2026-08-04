import { beforeEach, describe, expect, it } from 'vitest'
import {
  confirmChargeWithRecord,
  freezeBalance,
  getBalance,
  rollbackFreeze,
} from '@/lib/billing/ledger'
import { grantSubscriptionPeriodInTransaction } from '@/lib/billing/subscription-ledger'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'

/**
 * The oracle here is the database itself: which pool a balance moved out of,
 * and which pool it came back to, are persisted facts. These scenarios exist
 * because getting them wrong either lets a user spend credits after they
 * expire or quietly destroys credits they paid for.
 */

const HOUR = 60 * 60 * 1000

async function seedPools(userId: string, input: {
  recharge: number
  subscription: number
  subscriptionExpiresAt: Date | null
}) {
  await prisma.userBalance.upsert({
    where: { userId },
    create: {
      userId,
      balance: input.recharge,
      subscriptionCredits: input.subscription,
      subscriptionExpiresAt: input.subscriptionExpiresAt,
      frozenAmount: 0,
      totalSpent: 0,
    },
    update: {
      balance: input.recharge,
      subscriptionCredits: input.subscription,
      subscriptionExpiresAt: input.subscriptionExpiresAt,
      frozenAmount: 0,
      totalSpent: 0,
    },
  })
}

function readPools(userId: string) {
  return prisma.userBalance.findUniqueOrThrow({ where: { userId } })
}

const recordParams = (projectId: string) => ({
  projectId,
  action: 'credit_pool_test',
  apiType: 'image' as const,
  model: 'fal::gpt-image-2',
  quantity: 1,
  unit: 'image' as const,
})

describe('billing/credit pools integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('spends subscription credits before permanent credits', async () => {
    const user = await createTestUser()
    await seedPools(user.id, {
      recharge: 100,
      subscription: 30,
      subscriptionExpiresAt: new Date(Date.now() + HOUR),
    })

    const result = await freezeBalance(user.id, 50, { source: 'test' })
    expect(result.status).toBe('frozen')

    const pools = await readPools(user.id)
    expect(pools.subscriptionCredits).toBe(0)
    expect(pools.balance).toBe(80)
    expect(pools.frozenAmount).toBe(50)

    const freeze = await prisma.balanceFreeze.findFirstOrThrow({ where: { userId: user.id } })
    expect(freeze.subscriptionAmount).toBe(30)
  })

  it('does not spend subscription credits whose period has ended', async () => {
    const user = await createTestUser()
    await seedPools(user.id, {
      recharge: 10,
      subscription: 1_000,
      subscriptionExpiresAt: new Date(Date.now() - HOUR),
    })

    const balance = await getBalance(user.id)
    expect(balance.subscriptionCredits).toBe(0)
    expect(balance.balance).toBe(10)

    const result = await freezeBalance(user.id, 50, { source: 'test' })
    expect(result).toMatchObject({ status: 'insufficient_balance', required: 50, available: 10 })
  })

  it('returns an unused settlement remainder to the pool it came from', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedPools(user.id, {
      recharge: 100,
      subscription: 30,
      subscriptionExpiresAt: new Date(Date.now() + HOUR),
    })

    const frozen = await freezeBalance(user.id, 50, { source: 'test' })
    if (frozen.status !== 'frozen') throw new Error('expected freeze')

    // Charge 20 of the 50 frozen: it lands on the subscription portion first,
    // so 10 subscription credits and all 20 permanent ones come back.
    await confirmChargeWithRecord(frozen.freezeId, recordParams(project.id), { chargedAmount: 20 })

    const pools = await readPools(user.id)
    expect(pools.subscriptionCredits).toBe(10)
    expect(pools.balance).toBe(100)
    expect(pools.frozenAmount).toBe(0)
    expect(pools.totalSpent).toBe(20)
  })

  it('returns a rolled back freeze to both pools in the original proportions', async () => {
    const user = await createTestUser()
    await seedPools(user.id, {
      recharge: 100,
      subscription: 30,
      subscriptionExpiresAt: new Date(Date.now() + HOUR),
    })

    const frozen = await freezeBalance(user.id, 50, { source: 'test' })
    if (frozen.status !== 'frozen') throw new Error('expected freeze')

    expect(await rollbackFreeze(frozen.freezeId)).toBe(true)

    const pools = await readPools(user.id)
    expect(pools.subscriptionCredits).toBe(30)
    expect(pools.balance).toBe(100)
    expect(pools.frozenAmount).toBe(0)
  })

  it('does not resurrect subscription credits released after their period ended', async () => {
    const user = await createTestUser()
    await seedPools(user.id, {
      recharge: 100,
      subscription: 30,
      subscriptionExpiresAt: new Date(Date.now() + HOUR),
    })
    const frozen = await freezeBalance(user.id, 50, { source: 'test' })
    if (frozen.status !== 'frozen') throw new Error('expected freeze')

    // The period ends while the task is still running.
    await prisma.userBalance.update({
      where: { userId: user.id },
      data: { subscriptionExpiresAt: new Date(Date.now() - HOUR) },
    })
    expect(await rollbackFreeze(frozen.freezeId)).toBe(true)

    const pools = await readPools(user.id)
    // The 20 permanent credits come back; the 30 expired subscription credits
    // do not, because they would otherwise be spendable past their expiry.
    expect(pools.balance).toBe(100)
    expect(pools.subscriptionCredits).toBe(0)
    expect(pools.frozenAmount).toBe(0)

    const refund = await prisma.balanceTransaction.findFirstOrThrow({
      where: { userId: user.id, type: 'refund' },
    })
    expect(JSON.parse(refund.billingMeta || '{}')).toMatchObject({ expiredSubscriptionRefund: 30 })
  })

  it('replaces the pool on a new grant and forfeits the previous period', async () => {
    const user = await createTestUser()
    await seedPools(user.id, {
      recharge: 100,
      subscription: 40,
      subscriptionExpiresAt: new Date(Date.now() + HOUR),
    })
    const subscription = await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: 'creator',
        interval: 'year',
        status: 'active',
        currentPeriodStart: new Date(Date.now() - HOUR),
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * HOUR),
      },
    })

    const expiresAt = new Date(Date.now() + 30 * 24 * HOUR)
    const first = await prisma.$transaction(async (tx) => grantSubscriptionPeriodInTransaction(tx, {
      subscriptionId: subscription.id,
      userId: user.id,
      planId: 'creator',
      periodIndex: 1,
      credits: 5_600,
      expiresAt,
    }))
    expect(first).toMatchObject({ status: 'granted', credits: 5_600, expiredCredits: 40 })

    const pools = await readPools(user.id)
    // The new month replaces the old one rather than adding to it, and the
    // permanent pool is untouched by a grant.
    expect(pools.subscriptionCredits).toBe(5_600)
    expect(pools.balance).toBe(100)

    const replay = await prisma.$transaction(async (tx) => grantSubscriptionPeriodInTransaction(tx, {
      subscriptionId: subscription.id,
      userId: user.id,
      planId: 'creator',
      periodIndex: 1,
      credits: 5_600,
      expiresAt,
    }))
    expect(replay).toEqual({ status: 'already_granted' })
    expect((await readPools(user.id)).subscriptionCredits).toBe(5_600)
  })
})
