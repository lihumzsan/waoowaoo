import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleStripeWebhook } from '@/lib/payments/stripe-webhook'
import { getBalance } from '@/lib/billing'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestUser } from '../../helpers/billing-fixtures'

const WEBHOOK_SECRET = 'stripe_webhook_test_secret'

function signPayload(payload: string, timestamp: number): string {
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex')
  return `t=${timestamp},v1=${signature}`
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
        payment_status: input.paymentStatus || 'paid',
        metadata: input.managed === false ? {} : {
          waoowaoo_kind: 'credit_recharge',
          user_id: input.userId,
          credits: input.credits || '100.00',
          credit_value_currency: 'CNY',
          payment_amount: input.credits || '100.00',
          payment_currency: 'cny',
        },
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
    const payload = checkoutEvent({ sessionId: 'cs_live_paid', userId: user.id, credits: '88.88' })
    const signature = signPayload(payload, timestamp)

    const first = await handleStripeWebhook(payload, signature)
    const second = await handleStripeWebhook(payload, signature)

    expect(first).toEqual({
      received: true,
      action: 'credited',
      eventType: 'checkout.session.completed',
      sessionId: 'cs_live_paid',
      credits: 88.88,
    })
    expect(second.action).toBe('credited')

    const balance = await getBalance(user.id)
    expect(balance.balance).toBeCloseTo(88.88, 8)
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
})
