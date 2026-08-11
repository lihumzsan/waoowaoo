import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleStripeWebhook } from '@/lib/payments/stripe-webhook'
import { quotePlanPurchase } from '@/lib/payments/plan-purchase-quote'
import {
  getStripeWalletMethodConfig,
  STRIPE_WALLET_METHOD_IDS,
} from '@/lib/payments/stripe-wallet-methods'
import { getBalance } from '@/lib/billing'
import {
  attachPaidBetaProviderObject,
  beginPaidBetaPaymentAttempt,
  PAID_BETA_ATTEMPT_METADATA_KEY,
  PAID_BETA_CAMPAIGN_ID,
} from '@/lib/paid-beta/campaign'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestUser } from '../../helpers/billing-fixtures'

const WEBHOOK_SECRET = 'stripe_webhook_test_secret'

function signPayload(payload: string, timestamp: number): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
    timestamp,
  })
}

function currentStripeTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

function checkoutEvent(input: {
  type?: string
  sessionId: string
  userId?: string
  credits?: string
  paymentStatus?: string
  managed?: boolean
  paidBetaAttemptId?: string
}) {
  return JSON.stringify({
    id: `evt_${input.sessionId}`,
    type: input.type || 'checkout.session.completed',
    created: currentStripeTimestamp(),
    data: {
      object: {
        id: input.sessionId,
        created: currentStripeTimestamp(),
        payment_intent: `pi_${input.sessionId}`,
        payment_status: input.paymentStatus || 'paid',
        metadata: input.managed === false ? {} : {
          waoowaoo_kind: 'credit_recharge',
          user_id: input.userId,
          credits: input.credits || '100',
          credit_value_currency: 'CNY',
          payment_amount: input.credits || '100.00',
          payment_currency: 'cny',
          ...(input.paidBetaAttemptId
            ? { [PAID_BETA_ATTEMPT_METADATA_KEY]: input.paidBetaAttemptId }
            : {}),
        },
      },
    },
  })
}

function paymentIntentEvent(input: {
  paymentIntentId: string
  userId?: string
  credits?: string
  kind?: string
}) {
  const credits = input.credits || '100'
  return JSON.stringify({
    id: `evt_${input.paymentIntentId}`,
    type: 'payment_intent.succeeded',
    created: currentStripeTimestamp(),
    data: {
      object: {
        id: input.paymentIntentId,
        created: currentStripeTimestamp(),
        amount: Number(credits) * 10,
        currency: 'cny',
        metadata: {
          waoowaoo_kind: input.kind ?? 'credit_recharge_wechat',
          user_id: input.userId,
          credits,
          credit_value_currency: 'CNY',
          payment_amount: (Number(credits) / 10).toFixed(2),
          payment_currency: 'cny',
        },
      },
    },
  })
}

function walletPlanPaymentIntentEvent(input: {
  paymentIntentId: string
  userId: string
  kind: string
}) {
  return JSON.stringify({
    id: `evt_${input.paymentIntentId}`,
    type: 'payment_intent.succeeded',
    created: currentStripeTimestamp(),
    data: {
      object: {
        id: input.paymentIntentId,
        created: currentStripeTimestamp(),
        amount: 7_900,
        amount_received: 7_900,
        currency: 'cny',
        metadata: {
          waoowaoo_kind: input.kind,
          user_id: input.userId,
          plan_id: 'lite',
          plan_interval: 'month',
          payment_amount: '79.00',
          payment_currency: 'cny',
        },
      },
    },
  })
}

function refundEvent(input: {
  type?: 'refund.created' | 'refund.updated' | 'refund.failed'
  refundId: string
  paymentIntentId: string
  amountMinor: number
  status?: string
}) {
  return JSON.stringify({
    id: `evt_${input.type || 'refund.created'}_${input.refundId}`,
    type: input.type || 'refund.created',
    created: currentStripeTimestamp(),
    data: {
      object: {
        id: input.refundId,
        payment_intent: input.paymentIntentId,
        amount: input.amountMinor,
        currency: 'cny',
        status: input.status || 'succeeded',
      },
    },
  })
}

function disputeEvent(input: {
  type: 'charge.dispute.created' | 'charge.dispute.closed' | 'charge.dispute.funds_withdrawn' | 'charge.dispute.funds_reinstated'
  disputeId: string
  paymentIntentId: string
  amountMinor: number
  status: string
}) {
  return JSON.stringify({
    id: `evt_${input.type}_${input.disputeId}_${input.status}`,
    type: input.type,
    created: currentStripeTimestamp(),
    data: {
      object: {
        id: input.disputeId,
        payment_intent: input.paymentIntentId,
        amount: input.amountMinor,
        currency: 'cny',
        status: input.status,
      },
    },
  })
}

describe('billing/stripe recharge integration', () => {
  beforeEach(async () => {
    await resetBillingState()
    const now = new Date()
    await prisma.paidBetaCampaign.create({
      data: {
        id: PAID_BETA_CAMPAIGN_ID,
        status: 'active',
        capacity: 100,
        startsAt: new Date(now.getTime() - 60_000),
        legacyPaymentCutoffAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    })
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  })

  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET
  })

  it('credits a paid Stripe Checkout session and records an idempotent transaction', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const payload = checkoutEvent({ sessionId: 'cs_live_paid', userId: user.id, credits: '888' })
    const signature = signPayload(payload, timestamp)

    const first = await handleStripeWebhook(payload, signature)
    const second = await handleStripeWebhook(payload, signature)

    expect(first).toEqual({
      received: true,
      action: 'credited',
      eventType: 'checkout.session.completed',
      sessionId: 'cs_live_paid',
      credits: 888,
    })
    expect(second.action).toBe('credited')

    const balance = await getBalance(user.id)
    expect(balance.balance).toBe(888)
    expect(await prisma.balanceTransaction.count({
      where: {
        userId: user.id,
        type: 'recharge',
        externalOrderId: 'cs_live_paid',
        idempotencyKey: 'stripe:checkout:cs_live_paid',
      },
    })).toBe(1)
  })

  it('marks the exact reserved seat paid in the same transaction as its credit', async () => {
    const user = await createTestUser()
    const sessionId = 'cs_paid_beta_member'
    const attempt = await beginPaidBetaPaymentAttempt({
      userId: user.id,
      providerKind: 'stripe_checkout',
    })
    await attachPaidBetaProviderObject({
      attemptId: attempt.attemptId,
      providerObjectId: sessionId,
    })
    const payload = checkoutEvent({
      sessionId,
      userId: user.id,
      credits: '100',
      paidBetaAttemptId: attempt.attemptId,
    })

    await handleStripeWebhook(payload, signPayload(payload, currentStripeTimestamp()))

    const [seat, balance] = await Promise.all([
      prisma.paidBetaSeat.findUniqueOrThrow({ where: { id: attempt.seatId } }),
      getBalance(user.id),
    ])
    expect(seat.status).toBe('paid')
    expect(seat.paidAt).not.toBeNull()
    expect(balance.balance).toBe(100)
  })

  it('does not credit unpaid or unmanaged checkout sessions', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const unpaidPayload = checkoutEvent({
      sessionId: 'cs_live_unpaid',
      userId: user.id,
      paymentStatus: 'unpaid',
    })
    const unmanagedPayload = checkoutEvent({
      sessionId: 'cs_live_unmanaged',
      userId: user.id,
      managed: false,
    })

    await expect(handleStripeWebhook(unpaidPayload, signPayload(unpaidPayload, timestamp))).resolves.toMatchObject({
      action: 'ignored',
      reason: 'payment_not_paid',
    })
    await expect(handleStripeWebhook(unmanagedPayload, signPayload(unmanagedPayload, timestamp))).resolves.toMatchObject({
      action: 'ignored',
      reason: 'unmanaged_checkout_session',
    })

    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(0, 8)
    expect(await prisma.balanceTransaction.count({ where: { userId: user.id, type: 'recharge' } })).toBe(0)
  })

  it('rejects webhook payloads with invalid signatures', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const payload = checkoutEvent({ sessionId: 'cs_live_invalid_sig', userId: user.id })

    await expect(handleStripeWebhook(payload, `t=${timestamp},v1=bad`)).rejects.toThrow('STRIPE_SIGNATURE_MISMATCH')
  })

  it('reverses a partial refund once and restores credits when the refund fails', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const checkout = checkoutEvent({ sessionId: 'cs_refund', userId: user.id, credits: '100' })
    await handleStripeWebhook(checkout, signPayload(checkout, timestamp))

    const refund = refundEvent({
      refundId: 're_partial',
      paymentIntentId: 'pi_cs_refund',
      amountMinor: 2500,
    })
    const first = await handleStripeWebhook(refund, signPayload(refund, timestamp))
    const replay = await handleStripeWebhook(refund, signPayload(refund, timestamp))

    expect(first).toMatchObject({ action: 'debited', credits: 25, objectId: 're_partial' })
    expect(replay).toMatchObject({ action: 'debited', credits: 25, objectId: 're_partial' })
    expect((await getBalance(user.id)).balance).toBeCloseTo(75, 8)
    expect(await prisma.balanceTransaction.count({
      where: { userId: user.id, idempotencyKey: 'stripe:refund:re_partial:debit' },
    })).toBe(1)

    const failed = refundEvent({
      type: 'refund.failed',
      refundId: 're_partial',
      paymentIntentId: 'pi_cs_refund',
      amountMinor: 2500,
      status: 'failed',
    })
    const restored = await handleStripeWebhook(failed, signPayload(failed, timestamp))
    await handleStripeWebhook(failed, signPayload(failed, timestamp))
    expect(restored).toMatchObject({ action: 'restored', credits: 25 })
    expect((await getBalance(user.id)).balance).toBeCloseTo(100, 8)
    expect(await prisma.balanceTransaction.count({
      where: { userId: user.id, idempotencyKey: 'stripe:refund:re_partial:restore' },
    })).toBe(1)
  })

  it('changes credits only when Stripe withdraws or reinstates dispute funds', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const checkout = checkoutEvent({ sessionId: 'cs_dispute', userId: user.id, credits: '80' })
    await handleStripeWebhook(checkout, signPayload(checkout, timestamp))

    const created = disputeEvent({
      type: 'charge.dispute.created',
      disputeId: 'du_partial',
      paymentIntentId: 'pi_cs_dispute',
      amountMinor: 2000,
      status: 'needs_response',
    })
    await expect(handleStripeWebhook(created, signPayload(created, timestamp))).resolves.toMatchObject({
      action: 'ignored',
      reason: 'non_financial_dispute_event',
    })
    expect((await getBalance(user.id)).balance).toBeCloseTo(80, 8)

    const withdrawn = disputeEvent({
      type: 'charge.dispute.funds_withdrawn',
      disputeId: 'du_partial',
      paymentIntentId: 'pi_cs_dispute',
      amountMinor: 2000,
      status: 'needs_response',
    })
    await handleStripeWebhook(withdrawn, signPayload(withdrawn, timestamp))
    await handleStripeWebhook(withdrawn, signPayload(withdrawn, timestamp))
    expect((await getBalance(user.id)).balance).toBeCloseTo(60, 8)

    const lost = disputeEvent({
      type: 'charge.dispute.closed',
      disputeId: 'du_partial',
      paymentIntentId: 'pi_cs_dispute',
      amountMinor: 2000,
      status: 'lost',
    })
    await expect(handleStripeWebhook(lost, signPayload(lost, timestamp))).resolves.toMatchObject({
      action: 'ignored',
      reason: 'non_financial_dispute_event',
    })
    expect((await getBalance(user.id)).balance).toBeCloseTo(60, 8)

    const won = disputeEvent({
      type: 'charge.dispute.closed',
      disputeId: 'du_partial',
      paymentIntentId: 'pi_cs_dispute',
      amountMinor: 2000,
      status: 'won',
    })
    await expect(handleStripeWebhook(won, signPayload(won, timestamp))).resolves.toMatchObject({
      action: 'ignored',
      reason: 'non_financial_dispute_event',
    })
    expect((await getBalance(user.id)).balance).toBeCloseTo(60, 8)

    const reinstated = disputeEvent({
      type: 'charge.dispute.funds_reinstated',
      disputeId: 'du_partial',
      paymentIntentId: 'pi_cs_dispute',
      amountMinor: 2000,
      status: 'won',
    })
    await handleStripeWebhook(reinstated, signPayload(reinstated, timestamp))
    await handleStripeWebhook(reinstated, signPayload(reinstated, timestamp))
    expect((await getBalance(user.id)).balance).toBeCloseTo(80, 8)
    expect(await prisma.balanceTransaction.count({
      where: { userId: user.id, externalOrderId: 'stripe:dispute:du_partial' },
    })).toBe(2)
  })

  it.each(STRIPE_WALLET_METHOD_IDS)(
    'credits a %s top-up PaymentIntent exactly once',
    async (methodId) => {
      const user = await createTestUser()
      const timestamp = currentStripeTimestamp()
      const paymentIntentId = `pi_${methodId}_ok`
      const payload = paymentIntentEvent({
        paymentIntentId,
        userId: user.id,
        credits: '250',
        kind: getStripeWalletMethodConfig(methodId).rechargeMetadataKind,
      })
      const signature = signPayload(payload, timestamp)

      const first = await handleStripeWebhook(payload, signature)
      expect(first).toMatchObject({ action: 'credited', credits: 250, objectId: paymentIntentId })
      await handleStripeWebhook(payload, signature)

      expect((await getBalance(user.id)).balance).toBe(250)
      const rows = await prisma.balanceTransaction.findMany({
        where: { userId: user.id, type: 'recharge', idempotencyKey: `stripe:payment_intent:${paymentIntentId}` },
        select: { billingMeta: true },
      })
      expect(rows).toHaveLength(1)
      const billingMeta: unknown = JSON.parse(rows[0]?.billingMeta ?? '{}')
      expect(billingMeta).toMatchObject({ paymentMethod: methodId })
    },
  )

  it.each(STRIPE_WALLET_METHOD_IDS)(
    'starts a plan term from a %s PaymentIntent exactly once',
    async (methodId) => {
      const user = await createTestUser()
      const timestamp = currentStripeTimestamp()
      const paymentIntentId = `pi_${methodId}_plan`
      const payload = walletPlanPaymentIntentEvent({
        paymentIntentId,
        userId: user.id,
        kind: getStripeWalletMethodConfig(methodId).planMetadataKind,
      })
      const signature = signPayload(payload, timestamp)

      const first = await handleStripeWebhook(payload, signature)
      const replay = await handleStripeWebhook(payload, signature)

      expect(first).toMatchObject({ action: 'credited', credits: 800, objectId: paymentIntentId })
      expect(replay).toMatchObject({ action: 'ignored', reason: 'plan_purchase_already_applied' })
      const term = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } })
      expect(term).toMatchObject({ planId: 'lite', interval: 'month', currentTermKey: paymentIntentId })
      expect((await getBalance(user.id)).subscriptionCredits).toBe(800)
      expect(await prisma.balanceTransaction.count({
        where: { userId: user.id, idempotencyKey: `stripe:plan:${paymentIntentId}` },
      })).toBe(1)
    },
  )

  it('ignores the payment intent a card checkout also emits, so it cannot double credit', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    // A card Checkout produces both a session event and a payment intent
    // event. Only the session credits; the intent must be left alone.
    const checkout = checkoutEvent({ sessionId: 'cs_card', userId: user.id, credits: '100' })
    await handleStripeWebhook(checkout, signPayload(checkout, timestamp))

    const intent = paymentIntentEvent({
      paymentIntentId: 'pi_cs_card',
      userId: user.id,
      credits: '100',
      kind: 'credit_recharge',
    })
    const result = await handleStripeWebhook(intent, signPayload(intent, timestamp))

    expect(result).toMatchObject({ action: 'ignored', reason: 'unmanaged_payment_intent' })
    expect((await getBalance(user.id)).balance).toBe(100)
  })

  it('starts a plan term from a one-off purchase and grants its first month', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const payload = JSON.stringify({
      id: 'evt_plan_buy',
      type: 'checkout.session.completed',
      created: timestamp,
      data: {
        object: {
          id: 'cs_plan_buy',
          created: timestamp,
          payment_intent: 'pi_plan_buy',
          payment_status: 'paid',
          amount_total: 39_900,
          currency: 'cny',
          metadata: {
            waoowaoo_kind: 'credit_plan_purchase',
            user_id: user.id,
            plan_id: 'creator',
            plan_interval: 'month',
            payment_amount: '399.00',
            payment_currency: 'cny',
          },
        },
      },
    })
    const signature = signPayload(payload, timestamp)

    const first = await handleStripeWebhook(payload, signature)
    expect(first).toMatchObject({ action: 'credited' })

    // Replaying the delivery must not grant a second month.
    const replay = await handleStripeWebhook(payload, signature)
    expect(replay).toMatchObject({ action: 'ignored', reason: 'plan_purchase_already_applied' })

    const balance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })
    // A plan grants the expiring pool, never the permanent one.
    expect(balance.balance).toBe(0)

    const term = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } })
    expect(term.planId).toBe('creator')
    expect(term.interval).toBe('month')
    const grants = await prisma.subscriptionGrant.findMany({ where: { subscriptionId: term.id } })
    expect(grants).toHaveLength(1)
    expect(grants[0]?.credits).toBeGreaterThan(0)
    expect(balance.subscriptionCredits).toBe(grants[0]?.credits)
  })

  it('uses the first-purchase price only before the first successful plan payment', async () => {
    const user = await createTestUser()
    const first = await quotePlanPurchase({ userId: user.id, planId: 'creator', interval: 'month' })
    expect(first).toMatchObject({ amountCny: 399, promotionApplied: true, action: 'start' })
    await prisma.balanceTransaction.create({
      data: {
        userId: user.id,
        type: 'plan_purchase',
        amount: 0,
        balanceAfter: 0,
        externalOrderId: 'pi_prior_plan',
        idempotencyKey: 'stripe:plan:pi_prior_plan',
      },
    })
    const repeat = await quotePlanPurchase({ userId: user.id, planId: 'creator', interval: 'month' })
    expect(repeat).toMatchObject({ amountCny: 499, promotionApplied: false, action: 'start' })
  })

  it('restarts a running monthly term and immediately adds the complete grant', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const buy = (sessionId: string, eventCreated: number) => JSON.stringify({
      id: `evt_${sessionId}`,
      type: 'checkout.session.completed',
      created: eventCreated,
      data: {
        object: {
          id: sessionId,
          created: timestamp,
          payment_intent: `pi_${sessionId}`,
          payment_status: 'paid',
          amount_total: 49_900,
          currency: 'cny',
          metadata: {
            waoowaoo_kind: 'credit_plan_purchase',
            user_id: user.id,
            plan_id: 'creator',
            plan_interval: 'month',
            payment_amount: '499.00',
            payment_currency: 'cny',
          },
        },
      },
    })

    const firstPayload = buy('cs_term_1', timestamp)
    await handleStripeWebhook(firstPayload, signPayload(firstPayload, timestamp))
    const afterFirst = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } })
    const firstBalance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })

    const secondPaidAt = timestamp + 60
    const secondPayload = buy('cs_term_2', secondPaidAt)
    await handleStripeWebhook(secondPayload, signPayload(secondPayload, timestamp))
    const afterSecond = await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } })
    const secondBalance = await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })

    expect(afterSecond.currentPeriodStart).toEqual(new Date(secondPaidAt * 1000))
    expect(afterSecond.currentPeriodStart.getTime()).toBeGreaterThan(afterFirst.currentPeriodStart.getTime())
    expect(afterSecond.currentTermKey).toBe('pi_cs_term_2')
    expect(secondBalance.subscriptionCredits).toBe(firstBalance.subscriptionCredits * 2)
    expect(await prisma.subscriptionGrant.count({ where: { subscriptionId: afterSecond.id } })).toBe(2)
  })

  it('reverses an untouched immediate plan term and restores it if the refund fails', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const purchase = JSON.stringify({
      id: 'evt_plan_refund_buy',
      type: 'checkout.session.completed',
      created: timestamp,
      data: {
        object: {
          id: 'cs_plan_refund_buy',
          created: timestamp,
          payment_intent: 'pi_plan_refund_buy',
          payment_status: 'paid',
          amount_total: 7_900,
          currency: 'cny',
          metadata: {
            waoowaoo_kind: 'credit_plan_purchase',
            user_id: user.id,
            plan_id: 'lite',
            plan_interval: 'month',
            payment_amount: '79.00',
            payment_currency: 'cny',
          },
        },
      },
    })
    await handleStripeWebhook(purchase, signPayload(purchase, timestamp))
    expect((await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })).subscriptionCredits)
      .toBe(800)

    const refund = refundEvent({
      refundId: 're_plan_full',
      paymentIntentId: 'pi_plan_refund_buy',
      amountMinor: 7_900,
    })
    const reversed = await handleStripeWebhook(refund, signPayload(refund, timestamp))
    expect(reversed).toMatchObject({ action: 'debited', credits: 800 })
    expect((await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })).subscriptionCredits)
      .toBe(0)
    expect((await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } })).status)
      .toBe('refunded')

    const failed = refundEvent({
      type: 'refund.failed',
      refundId: 're_plan_full',
      paymentIntentId: 'pi_plan_refund_buy',
      amountMinor: 7_900,
      status: 'failed',
    })
    const restored = await handleStripeWebhook(failed, signPayload(failed, timestamp))
    expect(restored).toMatchObject({ action: 'restored', credits: 800 })
    expect((await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })).subscriptionCredits)
      .toBe(800)
    expect((await prisma.subscription.findUniqueOrThrow({ where: { userId: user.id } })).status)
      .toBe('active')
  })

  it('refunds a reconciled legacy purchase that only extended an ungranted future month', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const startsAt = new Date((timestamp - 24 * 60 * 60) * 1000)
    const previousEndsAt = new Date(startsAt)
    previousEndsAt.setUTCMonth(previousEndsAt.getUTCMonth() + 1)
    const extendedEndsAt = new Date(previousEndsAt)
    extendedEndsAt.setUTCMonth(extendedEndsAt.getUTCMonth() + 1)
    const subscription = await prisma.subscription.create({
      data: {
        userId: user.id,
        planId: 'lite',
        interval: 'month',
        currentTermKey: 'legacy_term',
        status: 'active',
        currentPeriodStart: startsAt,
        currentPeriodEnd: extendedEndsAt,
      },
    })
    await prisma.userBalance.upsert({
      where: { userId: user.id },
      create: { userId: user.id, balance: 0, subscriptionCredits: 0, frozenAmount: 0, totalSpent: 800 },
      update: { subscriptionCredits: 0, subscriptionExpiresAt: previousEndsAt },
    })
    await prisma.subscriptionGrant.create({
      data: {
        subscriptionId: subscription.id,
        termKey: 'legacy_term',
        periodIndex: 0,
        planId: 'lite',
        credits: 800,
        expiresAt: previousEndsAt,
        grantedAt: startsAt,
      },
    })
    await prisma.balanceTransaction.create({
      data: {
        userId: user.id,
        type: 'plan_purchase',
        amount: 0,
        balanceAfter: 0,
        relatedId: subscription.id,
        externalOrderId: 'pi_legacy_future_lite',
        idempotencyKey: 'stripe:plan:legacy_future_lite',
        billingMeta: JSON.stringify({
          purchaseMode: 'legacy_extend_v1',
          paymentIntentId: 'pi_legacy_future_lite',
          paymentAmountMinor: 7_900,
          paymentCurrency: 'cny',
          planId: 'lite',
          interval: 'month',
          grantedCredits: 0,
          paidAt: startsAt.toISOString(),
          termStartsAt: startsAt.toISOString(),
          termEndsAt: extendedEndsAt.toISOString(),
          previousTermEndsAt: previousEndsAt.toISOString(),
        }),
      },
    })

    const refund = refundEvent({
      refundId: 're_legacy_future_lite',
      paymentIntentId: 'pi_legacy_future_lite',
      amountMinor: 7_900,
    })
    const result = await handleStripeWebhook(refund, signPayload(refund, timestamp))
    expect(result).toMatchObject({ action: 'debited', credits: 0 })
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })
    expect(after.currentPeriodEnd).toEqual(previousEndsAt)
    expect((await prisma.userBalance.findUniqueOrThrow({ where: { userId: user.id } })).subscriptionCredits)
      .toBe(0)
  })

  it('fails closed when a refund cannot be tied to the canonical payment intent', async () => {
    const timestamp = currentStripeTimestamp()
    const refund = refundEvent({
      refundId: 're_unknown',
      paymentIntentId: 'pi_unknown',
      amountMinor: 100,
    })
    await expect(handleStripeWebhook(refund, signPayload(refund, timestamp)))
      .rejects.toThrow('STRIPE_RECHARGE_NOT_FOUND_FOR_PAYMENT_INTENT')
  })
})
