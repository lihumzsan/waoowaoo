import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import {
  isSubscriptionInterval,
  isSubscriptionPlanId,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from '@/lib/billing/subscription-plans'
import {
  grantSubscriptionPeriodInTransaction,
  expireSubscriptionPoolInTransaction,
} from '@/lib/billing/subscription-ledger'
import {
  addMonths,
  isGrantingSubscriptionStatus,
  resolvePeriodIndex,
  topUpCurrentPeriodForPlanChange,
} from '@/lib/billing/subscription-service'
import { getSubscriptionPlan } from '@/lib/billing/subscription-plans'
import { SUBSCRIPTION_CHECKOUT_KIND } from './stripe-subscription-checkout'

const webhookLogger = createScopedLogger({ module: 'billing.subscription-webhook' })

export type SubscriptionWebhookAction =
  | 'subscription_started'
  | 'subscription_renewed'
  | 'subscription_updated'
  | 'subscription_ended'
  | 'ignored'

export interface SubscriptionWebhookResult {
  readonly action: SubscriptionWebhookAction
  readonly subscriptionId?: string
  readonly planId?: string
  readonly credits?: number
  readonly reason?: string
}

interface SubscriptionMetadata {
  readonly userId: string
  readonly planId: SubscriptionPlanId
  readonly interval: SubscriptionInterval
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readExpandableId(value: string | { id: string } | null | undefined): string | null {
  return readString(typeof value === 'string' ? value : value?.id)
}

/**
 * Read the plan a Stripe object was created for.
 *
 * The plan is our fact, not Stripe's, so it must come from metadata we set at
 * checkout — never inferred from a price id or amount, which would silently
 * pick a plan if a price were ever edited in the Stripe dashboard.
 */
function readSubscriptionMetadata(metadata: Stripe.Metadata | null | undefined): SubscriptionMetadata | null {
  if (!metadata) return null
  if (metadata.waoowaoo_kind !== SUBSCRIPTION_CHECKOUT_KIND) return null
  const userId = readString(metadata.user_id)
  const planId = readString(metadata.plan_id)
  const interval = readString(metadata.plan_interval)
  if (!userId) throw new Error('STRIPE_SUBSCRIPTION_METADATA_USER_ID_REQUIRED')
  if (!planId || !isSubscriptionPlanId(planId)) throw new Error('STRIPE_SUBSCRIPTION_METADATA_PLAN_ID_INVALID')
  if (!interval || !isSubscriptionInterval(interval)) {
    throw new Error('STRIPE_SUBSCRIPTION_METADATA_INTERVAL_INVALID')
  }
  return { userId, planId, interval }
}

function toDate(epochSeconds: number | null | undefined, code: string): Date {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds)) throw new Error(code)
  return new Date(epochSeconds * 1000)
}

/**
 * Record the subscription and grant its first month.
 *
 * Both happen in one transaction: a subscription row that exists without its
 * period granted would leave a paying user with no credits until the next
 * event, and a grant without the row would have nothing to renew.
 */
export async function startSubscription(
  subscription: Stripe.Subscription,
): Promise<SubscriptionWebhookResult> {
  const meta = readSubscriptionMetadata(subscription.metadata)
  if (!meta) return { action: 'ignored', reason: 'unmanaged_subscription' }

  const customerId = readExpandableId(subscription.customer)
  if (!customerId) throw new Error('STRIPE_SUBSCRIPTION_CUSTOMER_REQUIRED')
  const periodStart = toDate(subscription.start_date, 'STRIPE_SUBSCRIPTION_START_REQUIRED')
  const periodEnd = toDate(
    subscription.items.data[0]?.current_period_end,
    'STRIPE_SUBSCRIPTION_PERIOD_END_REQUIRED',
  )
  const plan = getSubscriptionPlan(meta.planId)

  const credits = await prisma.$transaction(async (tx) => {
    // One subscription per user: switching plans updates this row rather than
    // creating a rival one, so there is never a second opinion about which
    // plan is in force.
    const row = await tx.subscription.upsert({
      where: { userId: meta.userId },
      create: {
        userId: meta.userId,
        planId: plan.id,
        interval: meta.interval,
        status: subscription.status,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customerId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
      update: {
        planId: plan.id,
        interval: meta.interval,
        status: subscription.status,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customerId,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    })

    if (!isGrantingSubscriptionStatus(subscription.status)) return 0

    const periodIndex = resolvePeriodIndex(row.createdAt, new Date())
    const result = await grantSubscriptionPeriodInTransaction(tx, {
      subscriptionId: row.id,
      userId: meta.userId,
      planId: plan.id,
      periodIndex,
      credits: plan.monthlyCredits,
      expiresAt: addMonths(row.createdAt, periodIndex + 1),
    })
    return result.status === 'granted' ? result.credits : 0
  })

  webhookLogger.info({
    audit: true,
    action: 'billing.subscription.started',
    message: 'subscription started',
    userId: meta.userId,
    details: { stripeSubscriptionId: subscription.id, planId: plan.id, interval: meta.interval, credits },
  })

  return { action: 'subscription_started', subscriptionId: subscription.id, planId: plan.id, credits }
}

/**
 * A paid invoice renews the term. It does not by itself grant credits for
 * every month of a yearly term — those are granted month by month, from the
 * same idempotent writer, as each period comes due.
 */
export async function renewSubscriptionFromInvoice(
  invoice: Stripe.Invoice,
): Promise<SubscriptionWebhookResult> {
  const stripeSubscriptionId = readExpandableId(
    (invoice as unknown as { subscription?: string | { id: string } }).subscription,
  )
  if (!stripeSubscriptionId) return { action: 'ignored', reason: 'invoice_without_subscription' }

  const row = await prisma.subscription.findUnique({ where: { stripeSubscriptionId } })
  if (!row) return { action: 'ignored', reason: 'unmanaged_subscription' }
  if (!isSubscriptionPlanId(row.planId)) throw new Error('STRIPE_SUBSCRIPTION_PLAN_UNKNOWN')

  const periodEnd = toDate(invoice.period_end, 'STRIPE_INVOICE_PERIOD_END_REQUIRED')
  const plan = getSubscriptionPlan(row.planId)

  const credits = await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: row.id },
      data: {
        status: 'active',
        currentPeriodStart: toDate(invoice.period_start, 'STRIPE_INVOICE_PERIOD_START_REQUIRED'),
        currentPeriodEnd: periodEnd,
      },
    })
    const periodIndex = resolvePeriodIndex(row.createdAt, new Date())
    const result = await grantSubscriptionPeriodInTransaction(tx, {
      subscriptionId: row.id,
      userId: row.userId,
      planId: plan.id,
      periodIndex,
      credits: plan.monthlyCredits,
      expiresAt: addMonths(row.createdAt, periodIndex + 1),
    })
    return result.status === 'granted' ? result.credits : 0
  })

  return { action: 'subscription_renewed', subscriptionId: stripeSubscriptionId, planId: plan.id, credits }
}

/**
 * Apply a plan change or cancellation flag.
 *
 * An upgrade takes effect at once and tops the current period up to the new
 * plan's grant. A downgrade only records the new plan — its smaller grant
 * applies from the next period, because credits already granted are not taken
 * back.
 */
export async function updateSubscription(
  subscription: Stripe.Subscription,
): Promise<SubscriptionWebhookResult> {
  const row = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  })
  if (!row) return { action: 'ignored', reason: 'unmanaged_subscription' }

  const meta = readSubscriptionMetadata(subscription.metadata)
  const nextPlanId = meta?.planId ?? (isSubscriptionPlanId(row.planId) ? row.planId : null)
  if (!nextPlanId) throw new Error('STRIPE_SUBSCRIPTION_PLAN_UNKNOWN')
  const periodEnd = toDate(
    subscription.items.data[0]?.current_period_end,
    'STRIPE_SUBSCRIPTION_PERIOD_END_REQUIRED',
  )

  const addedCredits = await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: row.id },
      data: {
        planId: nextPlanId,
        ...(meta ? { interval: meta.interval } : {}),
        status: subscription.status,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    })

    if (!isGrantingSubscriptionStatus(subscription.status)) return 0
    const periodIndex = resolvePeriodIndex(row.createdAt, new Date())
    const result = await topUpCurrentPeriodForPlanChange(tx, {
      subscriptionId: row.id,
      userId: row.userId,
      nextPlanId,
      periodIndex,
      expiresAt: addMonths(row.createdAt, periodIndex + 1),
    })
    return result.addedCredits
  })

  return {
    action: 'subscription_updated',
    subscriptionId: subscription.id,
    planId: nextPlanId,
    credits: addedCredits,
  }
}

/** Stripe reports the subscription gone: stop granting and clear the pool. */
export async function endSubscriptionFromStripe(
  subscription: Stripe.Subscription,
): Promise<SubscriptionWebhookResult> {
  const row = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id },
  })
  if (!row) return { action: 'ignored', reason: 'unmanaged_subscription' }

  const forfeited = await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: row.id },
      data: { status: subscription.status, cancelAtPeriodEnd: false },
    })
    // Bought credits are untouched. Ending a subscription only ends the pool
    // the subscription itself funded.
    const result = await expireSubscriptionPoolInTransaction(tx, {
      userId: row.userId,
      subscriptionId: row.id,
      reason: `stripe subscription ${subscription.status}`,
    })
    return result.forfeitedCredits
  })

  webhookLogger.info({
    audit: true,
    action: 'billing.subscription.ended',
    message: 'subscription ended',
    userId: row.userId,
    details: { stripeSubscriptionId: subscription.id, status: subscription.status, forfeitedCredits: forfeited },
  })

  return { action: 'subscription_ended', subscriptionId: subscription.id, planId: row.planId }
}

/**
 * A failed payment does not end anything on its own.
 *
 * Stripe retries on its own schedule and moves the subscription through
 * `past_due` before giving up. `past_due` still grants, which is the grace
 * period; only `unpaid`/`canceled` stop it, and those arrive as their own
 * events.
 */
export async function recordInvoicePaymentFailure(
  invoice: Stripe.Invoice,
): Promise<SubscriptionWebhookResult> {
  const stripeSubscriptionId = readExpandableId(
    (invoice as unknown as { subscription?: string | { id: string } }).subscription,
  )
  if (!stripeSubscriptionId) return { action: 'ignored', reason: 'invoice_without_subscription' }
  const row = await prisma.subscription.findUnique({ where: { stripeSubscriptionId } })
  if (!row) return { action: 'ignored', reason: 'unmanaged_subscription' }

  await prisma.subscription.update({
    where: { id: row.id },
    data: { status: 'past_due' },
  })
  webhookLogger.info({
    audit: true,
    action: 'billing.subscription.payment_failed',
    message: 'subscription invoice payment failed; grace period active',
    userId: row.userId,
    details: { stripeSubscriptionId, invoiceId: invoice.id },
  })
  return { action: 'subscription_updated', subscriptionId: stripeSubscriptionId, planId: row.planId }
}
