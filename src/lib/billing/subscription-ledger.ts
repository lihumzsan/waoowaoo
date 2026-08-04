import type { Prisma } from '@prisma/client'
import { createScopedLogger } from '@/lib/logging/core'
import { assertCreditAmount } from './credits'
import { usableSubscriptionCredits } from './credit-pools'

const subscriptionLedgerLogger = createScopedLogger({ module: 'billing.subscription-ledger' })

export interface GrantSubscriptionPeriodInput {
  readonly subscriptionId: string
  readonly userId: string
  readonly planId: string
  /** Months elapsed since the paid term began. A yearly term grants 0…11. */
  readonly periodIndex: number
  readonly credits: number
  readonly expiresAt: Date
}

export type GrantSubscriptionPeriodResult =
  | { readonly status: 'granted'; readonly credits: number; readonly expiredCredits: number }
  | { readonly status: 'already_granted' }

/**
 * Grant one period's credits, replacing whatever the previous period left.
 *
 * A subscription period's credits do not accumulate: granting a new month
 * clears the old month's remainder and writes an `expire` row for it, so the
 * ledger explains where those credits went. Only the subscription pool is
 * touched — credits the user bought outright are never affected by a grant.
 *
 * `SubscriptionGrant(subscriptionId, periodIndex)` is the idempotency key. A
 * retried webhook, a replayed workflow activity or a duplicate Stripe delivery
 * therefore grants once; the second attempt reports `already_granted` rather
 * than handing out free credits.
 */
export async function grantSubscriptionPeriodInTransaction(
  tx: Prisma.TransactionClient,
  input: GrantSubscriptionPeriodInput,
): Promise<GrantSubscriptionPeriodResult> {
  assertCreditAmount(input.credits, 'credits')
  if (!Number.isSafeInteger(input.periodIndex) || input.periodIndex < 0) {
    throw new Error('SUBSCRIPTION_GRANT_PERIOD_INDEX_INVALID')
  }

  const existing = await tx.subscriptionGrant.findUnique({
    where: {
      subscriptionId_periodIndex: {
        subscriptionId: input.subscriptionId,
        periodIndex: input.periodIndex,
      },
    },
    select: { id: true },
  })
  if (existing) return { status: 'already_granted' }

  const balance = await tx.userBalance.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, balance: 0, frozenAmount: 0, totalSpent: 0 },
    update: {},
  })

  // Whatever the previous period left behind is forfeited now. Reading it
  // through the same expiry rule the rest of the ledger uses keeps one
  // definition of "still valid".
  const now = new Date()
  const carriedOver = balance.subscriptionCredits
  const stillUsable = usableSubscriptionCredits(
    {
      subscriptionCredits: balance.subscriptionCredits,
      subscriptionExpiresAt: balance.subscriptionExpiresAt,
      rechargeCredits: balance.balance,
    },
    now,
  )

  await tx.userBalance.update({
    where: { userId: input.userId },
    data: {
      subscriptionCredits: input.credits,
      subscriptionExpiresAt: input.expiresAt,
    },
  })

  await tx.subscriptionGrant.create({
    data: {
      subscriptionId: input.subscriptionId,
      periodIndex: input.periodIndex,
      planId: input.planId,
      credits: input.credits,
      expiresAt: input.expiresAt,
    },
  })

  if (carriedOver > 0) {
    await tx.balanceTransaction.create({
      data: {
        userId: input.userId,
        type: 'subscription_expire',
        // The transfer amount lives in billingMeta for the same reason freeze
        // rows carry zero: expiry is not a change to the spendable total that
        // the reconcile invariant sums over.
        amount: 0,
        balanceAfter: balance.balance,
        description: '[EXPIRE] subscription period credits forfeited',
        relatedId: input.subscriptionId,
        billingMeta: JSON.stringify({
          planId: input.planId,
          periodIndex: input.periodIndex,
          forfeitedCredits: carriedOver,
          forfeitedUsableCredits: stillUsable,
        }),
      },
    })
  }

  await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      type: 'subscription_grant',
      amount: 0,
      balanceAfter: balance.balance,
      description: `[GRANT] ${input.planId} period ${input.periodIndex}`,
      relatedId: input.subscriptionId,
      idempotencyKey: `subscription:${input.subscriptionId}:${input.periodIndex}`,
      billingMeta: JSON.stringify({
        planId: input.planId,
        periodIndex: input.periodIndex,
        grantedCredits: input.credits,
        expiresAt: input.expiresAt.toISOString(),
      }),
    },
  })

  subscriptionLedgerLogger.info({
    audit: true,
    action: 'billing.subscription.granted',
    message: 'subscription period credits granted',
    userId: input.userId,
    details: {
      subscriptionId: input.subscriptionId,
      planId: input.planId,
      periodIndex: input.periodIndex,
      credits: input.credits,
      forfeitedCredits: carriedOver,
      expiresAt: input.expiresAt.toISOString(),
    },
  })

  return { status: 'granted', credits: input.credits, expiredCredits: carriedOver }
}

/**
 * Clear the subscription pool when a subscription stops granting.
 *
 * Called when a subscription reaches its end after cancellation, or when
 * Stripe reports it deleted. Bought credits are untouched: cancelling a
 * subscription must never take away what the user paid for separately.
 */
export async function expireSubscriptionPoolInTransaction(
  tx: Prisma.TransactionClient,
  input: { userId: string; subscriptionId: string; reason: string },
): Promise<{ forfeitedCredits: number }> {
  const balance = await tx.userBalance.findUnique({ where: { userId: input.userId } })
  if (!balance || balance.subscriptionCredits === 0) return { forfeitedCredits: 0 }

  const forfeited = balance.subscriptionCredits
  await tx.userBalance.update({
    where: { userId: input.userId },
    data: { subscriptionCredits: 0, subscriptionExpiresAt: null },
  })
  await tx.balanceTransaction.create({
    data: {
      userId: input.userId,
      type: 'subscription_expire',
      amount: 0,
      balanceAfter: balance.balance,
      description: `[EXPIRE] ${input.reason}`,
      relatedId: input.subscriptionId,
      billingMeta: JSON.stringify({ forfeitedCredits: forfeited, reason: input.reason }),
    },
  })

  subscriptionLedgerLogger.info({
    audit: true,
    action: 'billing.subscription.pool_expired',
    message: 'subscription credit pool cleared',
    userId: input.userId,
    details: { subscriptionId: input.subscriptionId, forfeitedCredits: forfeited, reason: input.reason },
  })

  return { forfeitedCredits: forfeited }
}
