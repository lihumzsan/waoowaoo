import { createStripeClient } from './stripe-client'
import { createScopedLogger } from '@/lib/logging/core'

const receiptLogger = createScopedLogger({ module: 'payments.stripe_receipt' })

/**
 * The Stripe-hosted receipt for a payment.
 *
 * Stripe already produces a receipt page per charge; linking to it is both
 * cheaper and more trustworthy than rendering our own, since it is issued by
 * the party that actually took the money.
 *
 * A missing receipt never fails the payment. The money has already moved and
 * the credits are already owed — losing the link is an inconvenience, and
 * failing the webhook over it would be far worse.
 */
export async function resolveReceiptUrl(paymentIntentId: string): Promise<string | null> {
  try {
    const intent = await createStripeClient().paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    })
    const charge = intent.latest_charge
    if (!charge || typeof charge === 'string') return null
    return charge.receipt_url ?? null
  } catch (error) {
    receiptLogger.warn({
      action: 'payments.receipt_lookup_failed',
      message: 'could not resolve a Stripe receipt url; the payment is unaffected',
      details: { paymentIntentId, reason: error instanceof Error ? error.message : 'unknown' },
    })
    return null
  }
}
