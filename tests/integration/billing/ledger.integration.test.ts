import { beforeEach, describe, expect, it } from 'vitest'
import {
  confirmChargeWithRecord,
  freezeBalance,
  getBalance,
  recordShadowUsage,
  rollbackFreeze,
} from '@/lib/billing/ledger'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser, seedBalance } from '../../helpers/billing-fixtures'

function requireFreezeId(result: Awaited<ReturnType<typeof freezeBalance>>): string {
  if (result.status !== 'frozen' && result.status !== 'already_frozen') {
    throw new Error(`EXPECTED_FREEZE_TO_SUCCEED:${result.status}`)
  }
  return result.freezeId
}

describe('billing/ledger integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    process.env.BILLING_MODE = 'ENFORCE'
  })

  it('freezes balance when enough funds exist', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    const result = await freezeBalance(user.id, 3, { idempotencyKey: 'freeze_ok' })
    expect(result.status).toBe('frozen')
    expect(requireFreezeId(result)).toBeTruthy()

    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(7, 8)
    expect(balance.frozenAmount).toBeCloseTo(3, 8)
  })

  it('returns an explicit insufficient-balance result', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 1)

    const result = await freezeBalance(user.id, 3, { idempotencyKey: 'freeze_no_money' })
    expect(result).toEqual({
      status: 'insufficient_balance',
      required: 3,
      available: 1,
    })
  })

  it('reuses same freeze record with the same idempotency key', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    const first = await freezeBalance(user.id, 2, { idempotencyKey: 'idem_key' })
    const second = await freezeBalance(user.id, 2, { idempotencyKey: 'idem_key' })

    expect(first.status).toBe('frozen')
    expect(second.status).toBe('already_frozen')
    expect(requireFreezeId(second)).toBe(requireFreezeId(first))

    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(8, 8)
    expect(balance.frozenAmount).toBeCloseTo(2, 8)
    expect(await prisma.balanceFreeze.count()).toBe(1)
  })

  it('returns an explicit conflict when an idempotency key is reused for a different amount', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    const first = await freezeBalance(user.id, 2, { idempotencyKey: 'idem_amount_mismatch' })
    const freezeId = requireFreezeId(first)

    await expect(freezeBalance(user.id, 3, { idempotencyKey: 'idem_amount_mismatch' })).resolves.toEqual({
      status: 'conflict',
      freezeId,
      freezeStatus: 'pending',
      frozenAmount: 2,
    })
    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(8, 8)
    expect(balance.frozenAmount).toBeCloseTo(2, 8)
  })

  it('supports partial confirmation and refunds difference', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const freezeId = requireFreezeId(await freezeBalance(user.id, 3, { idempotencyKey: 'confirm_partial' }))

    const confirmed = await confirmChargeWithRecord(
      freezeId,
      {
        projectId: project.id,
        action: 'integration_confirm',
        apiType: 'music',
        model: 'google::lyria-3-pro-preview',
        quantity: 2,
        unit: 'second',
      },
      { chargedAmount: 2 },
    )
    expect(confirmed).toBe(true)

    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(8, 8)
    expect(balance.frozenAmount).toBeCloseTo(0, 8)
    expect(balance.totalSpent).toBeCloseTo(2, 8)
    expect(await prisma.usageCost.count()).toBe(1)
  })

  it('is idempotent when confirm is called repeatedly', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const freezeId = requireFreezeId(await freezeBalance(user.id, 2, { idempotencyKey: 'confirm_idem' }))

    const first = await confirmChargeWithRecord(
      freezeId,
      {
        projectId: project.id,
        action: 'integration_confirm',
        apiType: 'image',
        model: 'ark::doubao-seedream-4-5-251128',
        quantity: 1,
        unit: 'image',
      },
      { chargedAmount: 1 },
    )
    const second = await confirmChargeWithRecord(
      freezeId,
      {
        projectId: project.id,
        action: 'integration_confirm',
        apiType: 'image',
        model: 'ark::doubao-seedream-4-5-251128',
        quantity: 1,
        unit: 'image',
      },
      { chargedAmount: 1 },
    )

    expect(first).toBe(true)
    expect(second).toBe(true)
    // 结算只产生一条 consume；freeze/refund 审计行各一条，重复 confirm 不追加任何行。
    expect(await prisma.balanceTransaction.count({ where: { freezeId, type: 'consume' } })).toBe(1)
    expect(await prisma.balanceTransaction.count({ where: { freezeId } })).toBe(3)
  })

  it('returns an explicit conflict instead of reusing a terminal freeze', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const first = await freezeBalance(user.id, 2, { idempotencyKey: 'terminal_freeze_conflict' })
    const freezeId = requireFreezeId(first)
    await confirmChargeWithRecord(
      freezeId,
      {
        projectId: project.id,
        action: 'integration_confirm',
        apiType: 'image',
        model: 'ark::doubao-seedream-4-5-251128',
        quantity: 1,
        unit: 'image',
      },
      { chargedAmount: 1 },
    )

    await expect(freezeBalance(user.id, 2, { idempotencyKey: 'terminal_freeze_conflict' })).resolves.toEqual({
      status: 'conflict',
      freezeId,
      freezeStatus: 'confirmed',
      frozenAmount: 2,
    })
  })

  it('rolls back pending freeze and restores funds', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 10)

    const freezeId = requireFreezeId(await freezeBalance(user.id, 4, { idempotencyKey: 'rollback_ok' }))

    const rolled = await rollbackFreeze(freezeId)
    expect(rolled).toBe(true)

    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(10, 8)
    expect(balance.frozenAmount).toBeCloseTo(0, 8)
  })

  it('returns false when trying to rollback a non-pending freeze', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    await seedBalance(user.id, 10)

    const freezeId = requireFreezeId(await freezeBalance(user.id, 2, { idempotencyKey: 'rollback_after_confirm' }))

    await confirmChargeWithRecord(
      freezeId,
      {
        projectId: project.id,
        action: 'integration_confirm',
        apiType: 'music',
        model: 'google::lyria-3-pro-preview',
        quantity: 5,
        unit: 'second',
      },
      { chargedAmount: 1 },
    )

    const rolled = await rollbackFreeze(freezeId)
    expect(rolled).toBe(false)
  })

  it('records shadow usage as audit transaction without balance change', async () => {
    const user = await createTestUser()
    await seedBalance(user.id, 5)

    const ok = await recordShadowUsage(user.id, {
      projectId: 'asset-hub',
      action: 'shadow_test',
      apiType: 'text',
      model: 'anthropic/claude-sonnet-4',
      quantity: 1200,
      unit: 'token',
      cost: 0.25,
      metadata: { source: 'test' },
    })
    expect(ok).toBe(true)

    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(5, 8)
    expect(balance.totalSpent).toBeCloseTo(0, 8)
    expect(await prisma.balanceTransaction.count({ where: { type: 'shadow_consume' } })).toBe(1)
  })
})
