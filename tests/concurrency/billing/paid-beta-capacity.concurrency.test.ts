import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginPaidBetaPaymentAttempt,
  isPaidBetaPaymentUnavailableError,
  PAID_BETA_CAMPAIGN_ID,
} from '@/lib/paid-beta/campaign'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestUser } from '../../helpers/billing-fixtures'

describe('paid beta capacity/concurrency', () => {
  beforeEach(async () => {
    await resetBillingState()
    const now = new Date()
    await prisma.paidBetaCampaign.create({
      data: {
        id: PAID_BETA_CAMPAIGN_ID,
        status: 'active',
        capacity: 1,
        startsAt: new Date(now.getTime() - 60_000),
        legacyPaymentCutoffAt: now,
      },
    })
  })

  it('allocates the final seat to exactly one concurrent user', async () => {
    const [firstUser, secondUser] = await Promise.all([
      createTestUser(),
      createTestUser(),
    ])

    const results = await Promise.allSettled([
      beginPaidBetaPaymentAttempt({
        userId: firstUser.id,
        providerKind: 'stripe_checkout',
      }),
      beginPaidBetaPaymentAttempt({
        userId: secondUser.id,
        providerKind: 'stripe_checkout',
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.status === 'rejected' && isPaidBetaPaymentUnavailableError(rejected[0].reason)).toBe(true)
    expect(await prisma.paidBetaSeat.count({
      where: { campaignId: PAID_BETA_CAMPAIGN_ID, status: 'reserved' },
    })).toBe(1)
    expect(await prisma.paidBetaPaymentAttempt.count({ where: { status: 'creating' } })).toBe(1)
  })
})
