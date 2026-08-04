import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleStripeWebhook } from '@/lib/payments/stripe-webhook'
import { getBalance } from '@/lib/billing'
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
}) {
  return JSON.stringify({
    id: `evt_${input.sessionId}`,
    type: input.type || 'checkout.session.completed',
    data: {
      object: {
        id: input.sessionId,
        payment_intent: `pi_${input.sessionId}`,
        payment_status: input.paymentStatus || 'paid',
        metadata: input.managed === false ? {} : {
          waoowaoo_kind: 'credit_recharge',
          user_id: input.userId,
          credits: input.credits || '100',
          credit_value_currency: 'CNY',
          payment_amount: input.credits || '100.00',
          payment_currency: 'cny',
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
    data: {
      object: {
        id: input.paymentIntentId,
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

  it('credits a WeChat Pay top-up from its payment intent, and only once', async () => {
    const user = await createTestUser()
    const timestamp = currentStripeTimestamp()
    const payload = paymentIntentEvent({ paymentIntentId: 'pi_wechat_ok', userId: user.id, credits: '250' })
    const signature = signPayload(payload, timestamp)

    const first = await handleStripeWebhook(payload, signature)
    expect(first).toMatchObject({ action: 'credited', credits: 250, objectId: 'pi_wechat_ok' })
    await handleStripeWebhook(payload, signature)

    expect((await getBalance(user.id)).balance).toBe(250)
    expect(await prisma.balanceTransaction.count({
      where: { userId: user.id, type: 'recharge', idempotencyKey: 'stripe:payment_intent:pi_wechat_ok' },
    })).toBe(1)
  })

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
