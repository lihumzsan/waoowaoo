import Stripe from 'stripe'

function readStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('STRIPE_SECRET_KEY_REQUIRED')
  }
  return key.trim()
}

export function createStripeClient(): Stripe {
  return new Stripe(readStripeSecretKey(), {
    // BA-25: single-shot create semantics; retries stay owned by Stripe's
    // webhook redelivery, never by the HTTP client.
    maxNetworkRetries: 0,
    // Pinned so an SDK upgrade cannot silently switch the wire protocol.
    apiVersion: '2026-06-24.dahlia',
  })
}
