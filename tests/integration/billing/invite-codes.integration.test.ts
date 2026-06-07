import { beforeEach, describe, expect, it } from 'vitest'
import { createInviteCode, redeemInviteCode } from '@/lib/billing/invite-codes'
import { getBalance } from '@/lib/billing'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestUser } from '../../helpers/billing-fixtures'

describe('billing invite codes integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('redeems an invite code into balance and transaction records', async () => {
    const user = await createTestUser()
    await createInviteCode({
      code: 'BETA-100',
      amount: 100,
      maxRedemptions: 2,
      createdBy: 'test',
    })

    const result = await redeemInviteCode({ userId: user.id, code: ' beta-100 ' })

    expect(result.success).toBe(true)
    expect(result.amount).toBe(100)
    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(100, 8)
    expect(await prisma.inviteRedemption.count({ where: { userId: user.id } })).toBe(1)
    const transaction = await prisma.balanceTransaction.findFirstOrThrow({
      where: { userId: user.id, type: 'adjust' },
    })
    expect(transaction.operatorId).toBe('invite-code')
    expect(transaction.amount.toString()).toBe('100')
  })

  it('prevents the same user from redeeming the same code twice', async () => {
    const user = await createTestUser()
    await createInviteCode({ code: 'ONCE', amount: 5, maxRedemptions: 3 })
    await redeemInviteCode({ userId: user.id, code: 'ONCE' })

    await expect(redeemInviteCode({ userId: user.id, code: 'ONCE' })).rejects.toThrow()

    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(5, 8)
    expect(await prisma.inviteRedemption.count()).toBe(1)
    expect(await prisma.balanceTransaction.count({ where: { userId: user.id, type: 'adjust' } })).toBe(1)
  })

  it('rejects expired, disabled, and exhausted invite codes', async () => {
    const first = await createTestUser()
    const second = await createTestUser()
    const third = await createTestUser()

    await createInviteCode({
      code: 'EXPIRED',
      amount: 10,
      expiresAt: new Date(Date.now() - 60_000),
    })
    const disabled = await createInviteCode({ code: 'DISABLED', amount: 10 })
    await prisma.inviteCode.update({
      where: { id: disabled.id },
      data: { disabledAt: new Date() },
    })
    await createInviteCode({ code: 'LIMITED', amount: 10, maxRedemptions: 1 })
    await redeemInviteCode({ userId: first.id, code: 'LIMITED' })

    await expect(redeemInviteCode({ userId: second.id, code: 'EXPIRED' })).rejects.toThrow()
    await expect(redeemInviteCode({ userId: second.id, code: 'DISABLED' })).rejects.toThrow()
    await expect(redeemInviteCode({ userId: third.id, code: 'LIMITED' })).rejects.toThrow()

    expect(await prisma.inviteRedemption.count()).toBe(1)
  })
})
