import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { createStripeClient } from '@/lib/payments/stripe-client'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

function readArgument(name: string): string | null {
  const prefix = `--${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim() || null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

async function resolveCharge(client: Stripe, intent: Stripe.PaymentIntent): Promise<Stripe.Charge> {
  if (typeof intent.latest_charge === 'object' && intent.latest_charge !== null) {
    return intent.latest_charge
  }
  if (typeof intent.latest_charge === 'string') {
    return client.charges.retrieve(intent.latest_charge)
  }
  throw new Error('UNUSED_PLAN_REFUND_CHARGE_REQUIRED')
}

async function main(): Promise<void> {
  const paymentIntentId = readArgument('payment-intent')
  const apply = process.argv.includes('--apply')
  if (!paymentIntentId) throw new Error('USAGE: --payment-intent=pi_... [--apply]')

  const transaction = await prisma.balanceTransaction.findFirst({
    where: { type: 'plan_purchase', externalOrderId: paymentIntentId },
  })
  if (!transaction?.relatedId) throw new Error('UNUSED_PLAN_REFUND_PURCHASE_NOT_FOUND')
  let metadata: Record<string, unknown> | null = null
  try {
    metadata = readRecord(transaction.billingMeta ? JSON.parse(transaction.billingMeta) : null)
  } catch {
    metadata = null
  }
  const purchaseMode = readString(metadata?.purchaseMode)
  const recordedPaymentIntent = readString(metadata?.paymentIntentId)
  const paymentAmountMinor = readInteger(metadata?.paymentAmountMinor)
  const paymentCurrency = readString(metadata?.paymentCurrency)?.toLowerCase() ?? null
  const grantedCredits = readInteger(metadata?.grantedCredits)
  const termEndsAtText = readString(metadata?.termEndsAt)
  const previousTermEndsAtText = readString(metadata?.previousTermEndsAt)
  if (
    purchaseMode !== 'legacy_extend_v1'
    || recordedPaymentIntent !== paymentIntentId
    || paymentAmountMinor === null
    || paymentAmountMinor <= 0
    || !paymentCurrency
    || grantedCredits !== 0
    || !termEndsAtText
    || !previousTermEndsAtText
  ) {
    throw new Error('UNUSED_PLAN_REFUND_FACTS_INVALID')
  }
  const termEndsAt = new Date(termEndsAtText)
  const previousTermEndsAt = new Date(previousTermEndsAtText)
  if (!Number.isFinite(termEndsAt.getTime()) || !Number.isFinite(previousTermEndsAt.getTime())) {
    throw new Error('UNUSED_PLAN_REFUND_TERM_INVALID')
  }

  const subscription = await prisma.subscription.findUnique({ where: { id: transaction.relatedId } })
  if (!subscription || subscription.currentPeriodEnd.getTime() !== termEndsAt.getTime()) {
    throw new Error('UNUSED_PLAN_REFUND_TERM_CHANGED')
  }
  const futureGrant = await prisma.subscriptionGrant.findFirst({
    where: { subscriptionId: subscription.id, periodIndex: { gt: 0 } },
    select: { id: true },
  })
  if (futureGrant) throw new Error('UNUSED_PLAN_REFUND_ALREADY_GRANTED')

  const stripe = createStripeClient()
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge'] })
  if (
    intent.status !== 'succeeded'
    || intent.amount_received !== paymentAmountMinor
    || intent.currency.toLowerCase() !== paymentCurrency
  ) {
    throw new Error('UNUSED_PLAN_REFUND_PROVIDER_FACTS_MISMATCH')
  }
  const charge = await resolveCharge(stripe, intent)
  _ulogInfo('[unused-plan-refund] verified', {
    apply,
    paymentIntentId,
    amountMinor: paymentAmountMinor,
    currency: paymentCurrency,
    alreadyRefundedMinor: charge.amount_refunded,
    currentTermEndsAt: termEndsAt.toISOString(),
    nextTermEndsAt: previousTermEndsAt.toISOString(),
  })
  if (charge.amount_refunded === paymentAmountMinor) return
  if (charge.amount_refunded !== 0) throw new Error('UNUSED_PLAN_REFUND_EXISTING_PARTIAL_REFUND')
  if (!apply) return

  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: paymentAmountMinor,
    metadata: {
      waoowaoo_kind: 'unused_plan_purchase_refund',
      plan_purchase_transaction_id: transaction.id,
    },
  }, { idempotencyKey: `waoowaoo:unused-plan-refund:${paymentIntentId}:full` })
  _ulogInfo('[unused-plan-refund] submitted', {
    paymentIntentId,
    refundId: refund.id,
    status: refund.status,
    amountMinor: refund.amount,
    currency: refund.currency,
  })
}

main()
  .catch((error: unknown) => {
    process.exitCode = 1
    throw error
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
