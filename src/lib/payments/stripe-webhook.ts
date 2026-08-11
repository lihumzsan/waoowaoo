import Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { addBalanceWithTransaction, applyBalanceAdjustmentWithTransaction } from '@/lib/billing/ledger'
import { BillingOperationError } from '@/lib/billing/errors'
import { toMoneyNumber } from '@/lib/billing/money'
import { PLAN_PURCHASE_KIND } from './stripe-plan-purchase'
import { resolveStripeWalletMetadataKind } from './stripe-wallet-methods'
import { applyPlanPurchaseInTransaction } from '@/lib/billing/plan-term-service'
import {
  restorePlanPaymentReversalInTransaction,
  reversePlanPaymentInTransaction,
} from '@/lib/billing/plan-reversal-service'
import { resolveReceiptUrl } from './stripe-receipt'
import {
  isSubscriptionInterval,
  isSubscriptionPlanId,
} from '@/lib/billing/subscription-plans'
import {
  expirePaidBetaPaymentAttempt,
  PAID_BETA_ATTEMPT_METADATA_KEY,
  settlePaidBetaPaymentInTransaction,
} from '@/lib/paid-beta/campaign'

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300

type StripeWebhookAction = 'credited' | 'debited' | 'restored' | 'ignored'

export interface StripeWebhookHandleResult {
  received: true
  action: StripeWebhookAction
  eventType: string
  sessionId?: string
  credits?: number
  objectId?: string
  reason?: string
}

interface StripeCheckoutSessionLike {
  id: string
  createdAt: Date
  paymentIntentId: string | null
  paymentStatus: string | null
  amountTotalMinor: number | null
  currency: string | null
  metadata: Record<string, string>
}

interface StripeRefundLike {
  id: string
  paymentIntentId: string
  amountMinor: number
  currency: string
  status: string | null
}

interface StripeDisputeLike {
  id: string
  paymentIntentId: string
  amountMinor: number
  currency: string
  status: string
}

type RechargeBillingMeta = {
  credits: number
  paymentAmountMinor: number
  paymentCurrency: string
}

function readStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('STRIPE_WEBHOOK_SECRET_REQUIRED')
  }
  return secret.trim()
}

function readStripeSignatureTimestamp(header: string): number {
  const timestampText = header
    .split(',')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === 't')?.[1]
  const timestamp = Number(timestampText)
  if (!Number.isFinite(timestamp)) throw new Error('STRIPE_SIGNATURE_HEADER_INVALID')
  return timestamp
}

function constructStripeEvent(
  rawBody: string,
  signatureHeader: string | null,
  secret = readStripeWebhookSecret(),
  nowMs = Date.now(),
): Stripe.Event {
  if (!signatureHeader) {
    throw new Error('STRIPE_SIGNATURE_HEADER_REQUIRED')
  }
  const timestamp = readStripeSignatureTimestamp(signatureHeader)
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestamp)
  if (ageSeconds > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    throw new Error('STRIPE_SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE')
  }
  try {
    return Stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      secret,
      STRIPE_SIGNATURE_TOLERANCE_SECONDS,
      undefined,
      nowMs,
    )
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
      const code = error.message.includes('Timestamp outside')
        ? 'STRIPE_SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE'
        : error.message.includes('matching the expected signature')
          ? 'STRIPE_SIGNATURE_MISMATCH'
          : 'STRIPE_SIGNATURE_HEADER_INVALID'
      throw new Error(code, { cause: error })
    }
    throw error
  }
}

export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret = readStripeWebhookSecret(),
  nowMs = Date.now(),
): void {
  constructStripeEvent(rawBody, signatureHeader, secret, nowMs)
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readExpandableId(value: string | { id: string } | null | undefined): string | null {
  return readString(typeof value === 'string' ? value : value?.id)
}

function readCheckoutSession(value: Stripe.Checkout.Session): StripeCheckoutSessionLike {
  const id = readString(value.id)
  const paymentIntentId = readExpandableId(value.payment_intent)
  if (!id) {
    throw new Error('STRIPE_CHECKOUT_SESSION_ID_REQUIRED')
  }
  return {
    id,
    createdAt: new Date(value.created * 1000),
    paymentIntentId,
    paymentStatus: readString(value.payment_status),
    amountTotalMinor: typeof value.amount_total === 'number' ? value.amount_total : null,
    currency: readString(value.currency)?.toLowerCase() ?? null,
    metadata: value.metadata ?? {},
  }
}

function readPositiveInteger(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(code)
  return value
}

function readRefund(value: Stripe.Refund): StripeRefundLike {
  const id = readString(value.id)
  const paymentIntentId = readExpandableId(value.payment_intent)
  const currency = readString(value.currency)?.toLowerCase() || null
  if (!id) throw new Error('STRIPE_REFUND_ID_REQUIRED')
  if (!paymentIntentId) throw new Error('STRIPE_REFUND_PAYMENT_INTENT_REQUIRED')
  if (!currency) throw new Error('STRIPE_REFUND_CURRENCY_REQUIRED')
  return {
    id,
    paymentIntentId,
    amountMinor: readPositiveInteger(value.amount, 'STRIPE_REFUND_AMOUNT_INVALID'),
    currency,
    status: readString(value.status),
  }
}

function readDispute(value: Stripe.Dispute): StripeDisputeLike {
  const id = readString(value.id)
  const paymentIntentId = readExpandableId(value.payment_intent)
  const currency = readString(value.currency)?.toLowerCase() || null
  const status = readString(value.status)
  if (!id) throw new Error('STRIPE_DISPUTE_ID_REQUIRED')
  if (!paymentIntentId) throw new Error('STRIPE_DISPUTE_PAYMENT_INTENT_REQUIRED')
  if (!currency) throw new Error('STRIPE_DISPUTE_CURRENCY_REQUIRED')
  if (!status) throw new Error('STRIPE_DISPUTE_STATUS_REQUIRED')
  return {
    id,
    paymentIntentId,
    amountMinor: readPositiveInteger(value.amount, 'STRIPE_DISPUTE_AMOUNT_INVALID'),
    currency,
    status,
  }
}

function readPositiveMetadataNumber(metadata: Record<string, string>, key: string): number {
  const value = Number(metadata[key])
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`STRIPE_CHECKOUT_METADATA_${key.toUpperCase()}_INVALID`)
  }
  return value
}

function readPlanPaymentFacts(
  metadata: Record<string, string>,
  actualAmountMinor: number | null,
  actualCurrency: string | null,
): { paymentAmountMinor: number; paymentCurrency: string } {
  const quotedAmount = readPositiveMetadataNumber(metadata, 'payment_amount')
  const quotedAmountMinor = Math.round(quotedAmount * 100)
  const quotedCurrency = readString(metadata.payment_currency)?.toLowerCase()
  if (!quotedCurrency) throw new Error('STRIPE_CHECKOUT_METADATA_PAYMENT_CURRENCY_REQUIRED')
  if (!Number.isSafeInteger(actualAmountMinor) || actualAmountMinor === null || actualAmountMinor <= 0) {
    throw new Error('STRIPE_PLAN_PAYMENT_AMOUNT_REQUIRED')
  }
  if (!actualCurrency) throw new Error('STRIPE_PLAN_PAYMENT_CURRENCY_REQUIRED')
  if (actualAmountMinor !== quotedAmountMinor) throw new Error('STRIPE_PLAN_PAYMENT_AMOUNT_MISMATCH')
  if (actualCurrency !== quotedCurrency) throw new Error('STRIPE_PLAN_PAYMENT_CURRENCY_MISMATCH')
  return { paymentAmountMinor: actualAmountMinor, paymentCurrency: actualCurrency }
}

/**
 * Settle a raw wallet PaymentIntent.
 *
 * Wallet flows have no Checkout session, so the PaymentIntent itself carries
 * the facts a session would have carried. The ledger row remains keyed on the
 * payment intent, which is also the identity used by refunds and disputes.
 */
async function creditWalletPaymentIntent(
  eventId: string,
  intent: Stripe.PaymentIntent,
  paidAt: Date,
): Promise<StripeWebhookHandleResult> {
  const metadata = intent.metadata ?? {}
  const walletPayment = resolveStripeWalletMetadataKind(metadata.waoowaoo_kind)

  if (!walletPayment) {
    return {
      received: true,
      action: 'ignored',
      eventType: 'payment_intent',
      objectId: intent.id,
      reason: 'unmanaged_payment_intent',
    }
  }

  // A plan bought with a wallet grants a term instead of permanent credits.
  if (walletPayment.purpose === 'plan') {
    const userId = readString(metadata.user_id)
    const planId = readString(metadata.plan_id)
    const interval = readString(metadata.plan_interval)
    if (!userId) throw new Error('STRIPE_CHECKOUT_METADATA_USER_ID_REQUIRED')
    if (!planId || !isSubscriptionPlanId(planId)) throw new Error('STRIPE_PLAN_METADATA_PLAN_ID_INVALID')
    if (!interval || !isSubscriptionInterval(interval)) throw new Error('STRIPE_PLAN_METADATA_INTERVAL_INVALID')
    const payment = readPlanPaymentFacts(
      metadata,
      intent.amount_received,
      readString(intent.currency)?.toLowerCase() ?? null,
    )
    const receiptUrl = await resolveReceiptUrl(intent.id)
    const applied = await prisma.$transaction(async (tx) => {
      await settlePaidBetaPaymentInTransaction(tx, {
        userId,
        providerObjectId: intent.id,
        providerCreatedAt: paidAt,
        attemptId: readString(metadata[PAID_BETA_ATTEMPT_METADATA_KEY]),
      })
      return applyPlanPurchaseInTransaction(tx, {
        userId,
        planId,
        interval,
        purchaseId: intent.id,
        providerObjectId: intent.id,
        paidAt,
        paymentAmountMinor: payment.paymentAmountMinor,
        paymentCurrency: payment.paymentCurrency,
        receiptUrl,
      })
    })
    return {
      received: true,
      action: applied.status === 'applied' ? 'credited' : 'ignored',
      eventType: 'payment_intent',
      objectId: intent.id,
      credits: applied.status === 'applied' ? applied.grantedCredits : undefined,
      reason: applied.status === 'already_applied' ? 'plan_purchase_already_applied' : undefined,
    }
  }

  const userId = readString(metadata.user_id)
  if (!userId) throw new Error('STRIPE_CHECKOUT_METADATA_USER_ID_REQUIRED')
  const credits = readPositiveMetadataNumber(metadata, 'credits')
  const paymentAmount = readPositiveMetadataNumber(metadata, 'payment_amount')
  const paymentCurrency = readString(metadata.payment_currency)?.toLowerCase()
  if (!paymentCurrency) throw new Error('STRIPE_CHECKOUT_METADATA_PAYMENT_CURRENCY_REQUIRED')
  const paymentAmountMinor = Math.round(paymentAmount * 100)
  const receiptUrl = await resolveReceiptUrl(intent.id)

  await prisma.$transaction(async (tx) => {
    await settlePaidBetaPaymentInTransaction(tx, {
      userId,
      providerObjectId: intent.id,
      providerCreatedAt: new Date(intent.created * 1000),
      attemptId: readString(metadata[PAID_BETA_ATTEMPT_METADATA_KEY]),
    })
    await addBalanceWithTransaction(tx, userId, credits, {
      type: 'recharge',
      reason: walletPayment.method.rechargeLedgerReason,
      externalOrderId: intent.id,
      idempotencyKey: `stripe:payment_intent:${intent.id}`,
      relatedId: intent.id,
      billingMeta: {
        provider: 'stripe',
        eventId,
        paymentIntentId: intent.id,
        paymentMethod: walletPayment.method.id,
        ...(receiptUrl ? { receiptUrl } : {}),
        credits,
        paymentAmountMinor,
        paymentCurrency,
      },
    })
  })

  return {
    received: true,
    action: 'credited',
    eventType: 'payment_intent',
    objectId: intent.id,
    credits,
  }
}

async function creditCheckoutSession(eventId: string, session: StripeCheckoutSessionLike): Promise<StripeWebhookHandleResult> {
  if (session.metadata.waoowaoo_kind !== 'credit_recharge') {
    return {
      received: true,
      action: 'ignored',
      eventType: 'checkout.session',
      sessionId: session.id,
      reason: 'unmanaged_checkout_session',
    }
  }
  if (session.paymentStatus !== 'paid') {
    return {
      received: true,
      action: 'ignored',
      eventType: 'checkout.session',
      sessionId: session.id,
      reason: 'payment_not_paid',
    }
  }

  const userId = readString(session.metadata.user_id)
  if (!userId) {
    throw new Error('STRIPE_CHECKOUT_METADATA_USER_ID_REQUIRED')
  }
  const credits = readPositiveMetadataNumber(session.metadata, 'credits')
  if (!session.paymentIntentId) throw new Error('STRIPE_CHECKOUT_PAYMENT_INTENT_REQUIRED')
  const paymentIntentId = session.paymentIntentId
  const paymentAmount = readPositiveMetadataNumber(session.metadata, 'payment_amount')
  const paymentCurrency = readString(session.metadata.payment_currency)?.toLowerCase()
  if (!paymentCurrency) throw new Error('STRIPE_CHECKOUT_METADATA_PAYMENT_CURRENCY_REQUIRED')
  const paymentAmountMinor = Math.round(paymentAmount * 100)
  const receiptUrl = await resolveReceiptUrl(paymentIntentId)

  await prisma.$transaction(async (tx) => {
    await settlePaidBetaPaymentInTransaction(tx, {
      userId,
      providerObjectId: session.id,
      providerCreatedAt: session.createdAt,
      attemptId: readString(session.metadata[PAID_BETA_ATTEMPT_METADATA_KEY]),
    })
    await addBalanceWithTransaction(tx, userId, credits, {
      type: 'recharge',
      reason: 'stripe checkout recharge',
      externalOrderId: session.id,
      idempotencyKey: `stripe:checkout:${session.id}`,
      relatedId: paymentIntentId,
      billingMeta: {
        provider: 'stripe',
        eventId,
        checkoutSessionId: session.id,
        paymentIntentId,
        ...(receiptUrl ? { receiptUrl } : {}),
        credits,
        paymentAmountMinor,
        paymentCurrency,
      },
    })
  })

  return {
    received: true,
    action: 'credited',
    eventType: 'checkout.session',
    sessionId: session.id,
    credits,
  }
}

function parseRechargeBillingMeta(value: string | null): RechargeBillingMeta {
  let record: Record<string, unknown> | null = null
  try {
    record = readRecord(value ? JSON.parse(value) : null)
  } catch {
    record = null
  }
  const credits = record?.credits
  const paymentAmountMinor = record?.paymentAmountMinor
  const paymentCurrency = readString(record?.paymentCurrency)?.toLowerCase()
  if (
    typeof credits !== 'number'
    || !Number.isFinite(credits)
    || credits <= 0
    || typeof paymentAmountMinor !== 'number'
    || !Number.isSafeInteger(paymentAmountMinor)
    || paymentAmountMinor <= 0
    || !paymentCurrency
  ) {
    throw new Error('STRIPE_RECHARGE_BILLING_META_INVALID')
  }
  return { credits, paymentAmountMinor, paymentCurrency }
}

async function findRechargeByPaymentIntent(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  paymentIntentId: string,
) {
  const recharge = await tx.balanceTransaction.findFirst({
    where: { type: 'recharge', relatedId: paymentIntentId },
    select: { userId: true, billingMeta: true },
  })
  if (!recharge) throw new Error('STRIPE_RECHARGE_NOT_FOUND_FOR_PAYMENT_INTENT')
  return { ...recharge, meta: parseRechargeBillingMeta(recharge.billingMeta) }
}

function creditsForMinorAmount(meta: RechargeBillingMeta, amountMinor: number, currency: string): number {
  if (currency !== meta.paymentCurrency) throw new Error('STRIPE_ADJUSTMENT_CURRENCY_MISMATCH')
  if (amountMinor > meta.paymentAmountMinor) throw new Error('STRIPE_ADJUSTMENT_AMOUNT_EXCEEDS_RECHARGE')
  // Credits are whole units, so a partial refund reverses whole credits. The
  // proportion is rounded down: a partial refund never claws back more credits
  // than the money returned paid for.
  const credits = Math.floor(meta.credits * amountMinor / meta.paymentAmountMinor)
  if (credits <= 0) throw new Error('STRIPE_ADJUSTMENT_CREDITS_INVALID')
  return credits
}

async function debitRefund(
  eventId: string,
  refund: StripeRefundLike,
  occurredAt: Date,
): Promise<StripeWebhookHandleResult> {
  if (refund.status === 'failed' || refund.status === 'canceled') {
    return { received: true, action: 'ignored', eventType: 'refund', objectId: refund.id, reason: `refund_${refund.status}` }
  }
  let credits = 0
  await prisma.$transaction(async (tx) => {
    const plan = await reversePlanPaymentInTransaction(tx, {
      eventId,
      objectType: 'refund',
      objectId: refund.id,
      paymentIntentId: refund.paymentIntentId,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      occurredAt,
    })
    if (plan.status !== 'not_plan_purchase') {
      credits = plan.credits
      return
    }
    const recharge = await findRechargeByPaymentIntent(tx, refund.paymentIntentId)
    credits = creditsForMinorAmount(recharge.meta, refund.amountMinor, refund.currency)
    await applyBalanceAdjustmentWithTransaction(tx, recharge.userId, -credits, {
      reason: 'stripe refund credit reversal',
      externalOrderId: `stripe:refund:${refund.id}`,
      idempotencyKey: `stripe:refund:${refund.id}:debit`,
      relatedId: refund.paymentIntentId,
      billingMeta: { provider: 'stripe', eventId, objectType: 'refund', objectId: refund.id, amountMinor: refund.amountMinor, currency: refund.currency },
    })
  })
  return { received: true, action: 'debited', eventType: 'refund', objectId: refund.id, credits }
}

async function restoreFailedRefund(eventId: string, refund: StripeRefundLike): Promise<StripeWebhookHandleResult> {
  let credits = 0
  let restored = false
  await prisma.$transaction(async (tx) => {
    const plan = await restorePlanPaymentReversalInTransaction(tx, {
      eventId,
      objectType: 'refund',
      objectId: refund.id,
    })
    if (plan.status !== 'not_plan_reversal') {
      credits = plan.credits
      restored = true
      return
    }
    const recharge = await findRechargeByPaymentIntent(tx, refund.paymentIntentId)
    credits = creditsForMinorAmount(recharge.meta, refund.amountMinor, refund.currency)
    const debit = await tx.balanceTransaction.findFirst({
      where: { userId: recharge.userId, type: 'adjust', idempotencyKey: `stripe:refund:${refund.id}:debit` },
      select: { amount: true },
    })
    if (!debit) return
    const debitedCredits = Math.abs(toMoneyNumber(debit.amount))
    await applyBalanceAdjustmentWithTransaction(tx, recharge.userId, debitedCredits, {
      reason: 'stripe failed refund credit restoration',
      externalOrderId: `stripe:refund:${refund.id}`,
      idempotencyKey: `stripe:refund:${refund.id}:restore`,
      relatedId: refund.paymentIntentId,
      billingMeta: { provider: 'stripe', eventId, objectType: 'refund', objectId: refund.id, status: refund.status },
    })
    credits = debitedCredits
    restored = true
  })
  return restored
    ? { received: true, action: 'restored', eventType: 'refund.failed', objectId: refund.id, credits }
    : { received: true, action: 'ignored', eventType: 'refund.failed', objectId: refund.id, reason: 'refund_debit_missing' }
}

async function debitDispute(
  eventId: string,
  dispute: StripeDisputeLike,
  occurredAt: Date,
): Promise<StripeWebhookHandleResult> {
  let credits = 0
  await prisma.$transaction(async (tx) => {
    const plan = await reversePlanPaymentInTransaction(tx, {
      eventId,
      objectType: 'dispute',
      objectId: dispute.id,
      paymentIntentId: dispute.paymentIntentId,
      amountMinor: dispute.amountMinor,
      currency: dispute.currency,
      occurredAt,
    })
    if (plan.status !== 'not_plan_purchase') {
      credits = plan.credits
      return
    }
    const recharge = await findRechargeByPaymentIntent(tx, dispute.paymentIntentId)
    credits = creditsForMinorAmount(recharge.meta, dispute.amountMinor, dispute.currency)
    await applyBalanceAdjustmentWithTransaction(tx, recharge.userId, -credits, {
      reason: 'stripe dispute credit reversal',
      externalOrderId: `stripe:dispute:${dispute.id}`,
      idempotencyKey: `stripe:dispute:${dispute.id}:debit`,
      relatedId: dispute.paymentIntentId,
      billingMeta: { provider: 'stripe', eventId, objectType: 'dispute', objectId: dispute.id, status: dispute.status, amountMinor: dispute.amountMinor, currency: dispute.currency },
    })
  })
  return { received: true, action: 'debited', eventType: 'charge.dispute.funds_withdrawn', objectId: dispute.id, credits }
}

async function restoreDisputeFunds(eventId: string, dispute: StripeDisputeLike): Promise<StripeWebhookHandleResult> {
  let credits = 0
  let restored = false
  await prisma.$transaction(async (tx) => {
    const plan = await restorePlanPaymentReversalInTransaction(tx, {
      eventId,
      objectType: 'dispute',
      objectId: dispute.id,
    })
    if (plan.status !== 'not_plan_reversal') {
      credits = plan.credits
      restored = true
      return
    }
    const recharge = await findRechargeByPaymentIntent(tx, dispute.paymentIntentId)
    const debit = await tx.balanceTransaction.findFirst({
      where: { userId: recharge.userId, type: 'adjust', idempotencyKey: `stripe:dispute:${dispute.id}:debit` },
      select: { amount: true },
    })
    if (!debit) return
    credits = Math.abs(toMoneyNumber(debit.amount))
    await applyBalanceAdjustmentWithTransaction(tx, recharge.userId, credits, {
      reason: 'stripe dispute funds restoration',
      externalOrderId: `stripe:dispute:${dispute.id}`,
      idempotencyKey: `stripe:dispute:${dispute.id}:restore`,
      relatedId: dispute.paymentIntentId,
      billingMeta: { provider: 'stripe', eventId, objectType: 'dispute', objectId: dispute.id, status: dispute.status },
    })
    restored = true
  })
  return restored
    ? { received: true, action: 'restored', eventType: 'charge.dispute.funds_reinstated', objectId: dispute.id, credits }
    : { received: true, action: 'ignored', eventType: 'charge.dispute.funds_reinstated', objectId: dispute.id, reason: 'dispute_debit_missing' }
}

export async function handleStripeWebhook(rawBody: string, signatureHeader: string | null): Promise<StripeWebhookHandleResult> {
  const event = constructStripeEvent(rawBody, signatureHeader)
  const eventId = readString(event.id)
  const eventType = readString(event.type)
  if (!eventId || !eventType) throw new Error('STRIPE_EVENT_MISSING_REQUIRED_FIELDS')

  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const session = readCheckoutSession(event.data.object)
    const attemptId = readString(session.metadata[PAID_BETA_ATTEMPT_METADATA_KEY])
    if (attemptId) await expirePaidBetaPaymentAttempt(attemptId)
    return {
      received: true,
      action: 'ignored',
      eventType: event.type,
      sessionId: session.id,
      reason: attemptId ? 'paid_beta_attempt_expired' : `pre_campaign_${event.type}`,
    }
  }

  if (event.type === 'payment_intent.canceled') {
    const intent = event.data.object
    const attemptId = readString(intent.metadata?.[PAID_BETA_ATTEMPT_METADATA_KEY])
    if (attemptId) await expirePaidBetaPaymentAttempt(attemptId)
    return {
      received: true,
      action: 'ignored',
      eventType: event.type,
      objectId: intent.id,
      reason: attemptId ? 'paid_beta_attempt_canceled' : 'pre_campaign_payment_canceled',
    }
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = readCheckoutSession(event.data.object)
    // A plan purchase grants credits to the subscription pool instead of the
    // permanent one, so it takes its own path rather than the recharge one.
    if (session.metadata.waoowaoo_kind === PLAN_PURCHASE_KIND) {
      if (session.paymentStatus !== 'paid') {
        return {
          received: true,
          action: 'ignored',
          eventType: event.type,
          sessionId: session.id,
          reason: 'payment_not_paid',
        }
      }
      const userId = readString(session.metadata.user_id)
      const planId = readString(session.metadata.plan_id)
      const interval = readString(session.metadata.plan_interval)
      if (!userId) throw new Error('STRIPE_CHECKOUT_METADATA_USER_ID_REQUIRED')
      if (!planId || !isSubscriptionPlanId(planId)) {
        throw new Error('STRIPE_PLAN_METADATA_PLAN_ID_INVALID')
      }
      if (!interval || !isSubscriptionInterval(interval)) {
        throw new Error('STRIPE_PLAN_METADATA_INTERVAL_INVALID')
      }
      if (!session.paymentIntentId) throw new Error('STRIPE_CHECKOUT_PAYMENT_INTENT_REQUIRED')
      const paymentIntentId = session.paymentIntentId
      const payment = readPlanPaymentFacts(
        session.metadata,
        session.amountTotalMinor,
        session.currency,
      )
      const paidAt = new Date(event.created * 1000)
      const receiptUrl = await resolveReceiptUrl(paymentIntentId)
      const applied = await prisma.$transaction(async (tx) => {
        await settlePaidBetaPaymentInTransaction(tx, {
          userId,
          providerObjectId: session.id,
          providerCreatedAt: paidAt,
          attemptId: readString(session.metadata[PAID_BETA_ATTEMPT_METADATA_KEY]),
        })
        return applyPlanPurchaseInTransaction(tx, {
          userId,
          planId,
          interval,
          purchaseId: paymentIntentId,
          providerObjectId: session.id,
          paidAt,
          paymentAmountMinor: payment.paymentAmountMinor,
          paymentCurrency: payment.paymentCurrency,
          receiptUrl,
        })
      })
      return {
        received: true,
        action: applied.status === 'applied' ? 'credited' : 'ignored',
        eventType: event.type,
        sessionId: session.id,
        credits: applied.status === 'applied' ? applied.grantedCredits : undefined,
        reason: applied.status === 'already_applied' ? 'plan_purchase_already_applied' : undefined,
      }
    }
    const result = await creditCheckoutSession(eventId, session)
    return {
      ...result,
      eventType: event.type,
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const result = await creditWalletPaymentIntent(
      eventId,
      event.data.object,
      new Date(event.created * 1000),
    )
    return { ...result, eventType: event.type }
  }

  if (event.type === 'refund.created') {
    const result = await debitRefund(
      eventId,
      readRefund(event.data.object),
      new Date(event.created * 1000),
    )
    return { ...result, eventType: event.type }
  }

  if (event.type === 'refund.failed') {
    const result = await restoreFailedRefund(eventId, readRefund(event.data.object))
    return { ...result, eventType: event.type }
  }

  if (event.type === 'refund.updated') {
    const refund = readRefund(event.data.object)
    if (refund.status === 'failed' || refund.status === 'canceled') {
      const result = await restoreFailedRefund(eventId, refund)
      return { ...result, eventType: event.type }
    }
    const result = await debitRefund(eventId, refund, new Date(event.created * 1000))
    return { ...result, eventType: event.type }
  }

  if (event.type === 'charge.dispute.funds_withdrawn') {
    const result = await debitDispute(
      eventId,
      readDispute(event.data.object),
      new Date(event.created * 1000),
    )
    return { ...result, eventType: event.type }
  }

  if (event.type === 'charge.dispute.funds_reinstated') {
    const result = await restoreDisputeFunds(eventId, readDispute(event.data.object))
    return { ...result, eventType: event.type }
  }

  if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
    const dispute = readDispute(event.data.object)
    return { received: true, action: 'ignored', eventType: event.type, objectId: dispute.id, reason: 'non_financial_dispute_event' }
  }

  return {
    received: true,
    action: 'ignored',
    eventType: event.type,
    reason: 'unhandled_event_type',
  }
}

const PERMANENT_WEBHOOK_REJECTION_CODES: ReadonlySet<string> = new Set([
  'STRIPE_EVENT_MISSING_REQUIRED_FIELDS',
  'STRIPE_CHECKOUT_SESSION_ID_REQUIRED',
  'STRIPE_CHECKOUT_PAYMENT_INTENT_REQUIRED',
  'STRIPE_REFUND_ID_REQUIRED',
  'STRIPE_REFUND_PAYMENT_INTENT_REQUIRED',
  'STRIPE_REFUND_CURRENCY_REQUIRED',
  'STRIPE_DISPUTE_ID_REQUIRED',
  'STRIPE_DISPUTE_PAYMENT_INTENT_REQUIRED',
  'STRIPE_DISPUTE_CURRENCY_REQUIRED',
  'STRIPE_DISPUTE_STATUS_REQUIRED',
  'STRIPE_RECHARGE_BILLING_META_INVALID',
  'STRIPE_ADJUSTMENT_CURRENCY_MISMATCH',
  'STRIPE_ADJUSTMENT_AMOUNT_EXCEEDS_RECHARGE',
  'STRIPE_ADJUSTMENT_CREDITS_INVALID',
  'BILLING_ADJUSTMENT_IDEMPOTENCY_CONFLICT',
])

export function readStripeWebhookErrorCode(error: unknown): string {
  if (error instanceof BillingOperationError) return error.code
  const message = error instanceof Error ? error.message : ''
  return message.split(':')[0] ?? ''
}

/**
 * Stripe's redelivery contract reads only the HTTP status: 4xx marks the event
 * permanently unprocessable (redelivery stops), everything else keeps
 * redelivery alive. Signature failures and immutable payload/ledger fact
 * violations can never succeed on retry; missing local facts and
 * infrastructure failures must stay retryable so the event remains visible
 * until reconciled.
 */
export function isPermanentStripeWebhookRejection(error: unknown): boolean {
  const code = readStripeWebhookErrorCode(error)
  return (
    code.startsWith('STRIPE_SIGNATURE_')
    || code.startsWith('STRIPE_SUBSCRIPTION_METADATA_')
    || code.startsWith('STRIPE_CHECKOUT_METADATA_')
    || PERMANENT_WEBHOOK_REJECTION_CODES.has(code)
  )
}
