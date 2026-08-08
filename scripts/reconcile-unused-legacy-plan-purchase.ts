import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { addMonths } from '@/lib/billing/subscription-service'
import { createStripeClient } from '@/lib/payments/stripe-client'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

function readArgument(name: string): string | null {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  return value?.trim() || null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPositiveInteger(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(code)
  return value
}

function readDate(value: unknown, code: string): Date {
  const text = readString(value)
  const date = text ? new Date(text) : new Date(Number.NaN)
  if (!Number.isFinite(date.getTime())) throw new Error(code)
  return date
}

async function resolvePaidAt(client: Stripe, intent: Stripe.PaymentIntent): Promise<Date> {
  const latestCharge = intent.latest_charge
  if (typeof latestCharge === 'object' && latestCharge !== null) {
    return new Date(latestCharge.created * 1000)
  }
  if (typeof latestCharge === 'string') {
    const charge = await client.charges.retrieve(latestCharge)
    return new Date(charge.created * 1000)
  }
  throw new Error('LEGACY_PLAN_PURCHASE_CHARGE_REQUIRED')
}

async function main(): Promise<void> {
  const paymentIntentId = readArgument('payment-intent')
  const apply = process.argv.includes('--apply')
  if (!paymentIntentId) throw new Error('USAGE: --payment-intent=pi_... [--apply]')

  const transaction = await prisma.balanceTransaction.findFirst({
    where: { type: 'plan_purchase', externalOrderId: paymentIntentId },
  })
  if (!transaction?.relatedId) throw new Error('LEGACY_PLAN_PURCHASE_NOT_FOUND')
  let metadata: Record<string, unknown> | null = null
  try {
    metadata = readRecord(transaction.billingMeta ? JSON.parse(transaction.billingMeta) : null)
  } catch {
    metadata = null
  }
  if (!metadata) throw new Error('LEGACY_PLAN_PURCHASE_METADATA_INVALID')
  if (metadata.purchaseMode === 'legacy_extend_v1') {
    _ulogInfo('[legacy-plan-reconcile] already reconciled', { paymentIntentId, transactionId: transaction.id })
    return
  }

  const planId = readString(metadata.planId)
  const interval = readString(metadata.interval)
  const months = readPositiveInteger(metadata.months, 'LEGACY_PLAN_PURCHASE_MONTHS_INVALID')
  const monthlyCredits = readPositiveInteger(
    metadata.monthlyCredits,
    'LEGACY_PLAN_PURCHASE_MONTHLY_CREDITS_INVALID',
  )
  const termStartsAt = readDate(metadata.termStartsAt, 'LEGACY_PLAN_PURCHASE_START_INVALID')
  const termEndsAt = readDate(metadata.termEndsAt, 'LEGACY_PLAN_PURCHASE_END_INVALID')
  if (!planId || !interval) throw new Error('LEGACY_PLAN_PURCHASE_PLAN_INVALID')

  const previousTermEndsAt = addMonths(termEndsAt, -months)
  const subscription = await prisma.subscription.findUnique({ where: { id: transaction.relatedId } })
  if (
    !subscription
    || subscription.planId !== planId
    || subscription.currentPeriodEnd.getTime() !== termEndsAt.getTime()
  ) {
    throw new Error('LEGACY_PLAN_PURCHASE_TERM_CHANGED')
  }
  const futureGrant = await prisma.subscriptionGrant.findFirst({
    where: {
      subscriptionId: subscription.id,
      periodIndex: { gt: 0 },
    },
    select: { id: true },
  })
  if (futureGrant) throw new Error('LEGACY_PLAN_PURCHASE_ALREADY_GRANTED')

  const stripe = createStripeClient()
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
  if (intent.status !== 'succeeded') throw new Error('LEGACY_PLAN_PURCHASE_PAYMENT_NOT_SUCCEEDED')
  const paymentAmountMinor = readPositiveInteger(
    intent.amount_received,
    'LEGACY_PLAN_PURCHASE_AMOUNT_INVALID',
  )
  const paymentCurrency = readString(intent.currency)?.toLowerCase()
  if (!paymentCurrency) throw new Error('LEGACY_PLAN_PURCHASE_CURRENCY_INVALID')
  const paidAt = await resolvePaidAt(stripe, intent)

  const reconciled = {
    ...metadata,
    provider: 'stripe',
    purchaseMode: 'legacy_extend_v1',
    paymentIntentId,
    paymentAmountMinor,
    paymentCurrency,
    grantedCredits: 0,
    carriedCredits: 0,
    paidAt: paidAt.toISOString(),
    termStartsAt: termStartsAt.toISOString(),
    termEndsAt: termEndsAt.toISOString(),
    previousTermEndsAt: previousTermEndsAt.toISOString(),
    monthlyCredits,
  }
  _ulogInfo('[legacy-plan-reconcile] verified', {
    apply,
    transactionId: transaction.id,
    paymentIntentId,
    planId,
    interval,
    paymentAmountMinor,
    paymentCurrency,
    previousTermEndsAt: previousTermEndsAt.toISOString(),
    termEndsAt: termEndsAt.toISOString(),
  })
  if (!apply) return

  const updated = await prisma.balanceTransaction.updateMany({
    where: {
      id: transaction.id,
      billingMeta: transaction.billingMeta,
    },
    data: { billingMeta: JSON.stringify(reconciled) },
  })
  if (updated.count !== 1) throw new Error('LEGACY_PLAN_PURCHASE_CONCURRENT_UPDATE')
  _ulogInfo('[legacy-plan-reconcile] applied', { transactionId: transaction.id, paymentIntentId })
}

main()
  .catch((error: unknown) => {
    process.exitCode = 1
    throw error
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
