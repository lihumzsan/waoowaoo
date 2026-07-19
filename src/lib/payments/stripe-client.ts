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
    maxNetworkRetries: 0,
  })
}
