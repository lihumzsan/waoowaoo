import { createScopedLogger } from '@/lib/logging/core'
import {
  beginPaidBetaPaymentAttempt,
  expirePaidBetaPaymentAttempt,
  isPaidBetaPaymentUnavailableError,
  listStalePaidBetaPaymentAttempts,
  type PaidBetaPaymentAttemptClaim,
  type PaidBetaProviderKind,
} from '@/lib/paid-beta/campaign'
import { createStripeClient } from './stripe-client'

const cleanupLogger = createScopedLogger({ module: 'payments.paid-beta-admission' })

async function providerConfirmsAttemptCannotPay(
  attempt: Awaited<ReturnType<typeof listStalePaidBetaPaymentAttempts>>[number],
): Promise<boolean> {
  if (!attempt.providerObjectId) return true
  const stripe = createStripeClient()

  if (attempt.providerKind === 'stripe_checkout') {
    const session = await stripe.checkout.sessions.retrieve(attempt.providerObjectId)
    if (session.payment_status === 'paid' || session.status === 'complete') return false
    if (session.status === 'expired') return true
    if (session.status === 'open') {
      const expired = await stripe.checkout.sessions.expire(session.id)
      return expired.status === 'expired'
    }
    return false
  }

  const intent = await stripe.paymentIntents.retrieve(attempt.providerObjectId)
  if (intent.status === 'succeeded' || intent.status === 'processing') return false
  if (intent.status === 'canceled') return true
  if (
    intent.status === 'requires_payment_method'
    || intent.status === 'requires_confirmation'
    || intent.status === 'requires_action'
  ) {
    const canceled = await stripe.paymentIntents.cancel(intent.id)
    return canceled.status === 'canceled'
  }
  return false
}

/**
 * Capacity cleanup never trusts a local timeout alone. A seat is released only
 * after Stripe says the attempt is expired/canceled, so a late paid webhook
 * cannot turn a recycled reservation into participant 101.
 */
async function releaseProviderTerminalAttempts(): Promise<void> {
  const stale = await listStalePaidBetaPaymentAttempts()
  for (const attempt of stale) {
    try {
      if (await providerConfirmsAttemptCannotPay(attempt)) {
        await expirePaidBetaPaymentAttempt(attempt.id)
      }
    } catch (error) {
      cleanupLogger.warn({
        action: 'payments.paid_beta.cleanup_failed',
        message: 'stale paid-beta attempt could not be proven terminal',
        details: {
          attemptId: attempt.id,
          providerKind: attempt.providerKind,
          providerObjectId: attempt.providerObjectId,
          reason: error instanceof Error ? error.message : 'unknown',
        },
      })
    }
  }
}

export async function admitPaidBetaPayment(
  input: { readonly userId: string; readonly providerKind: PaidBetaProviderKind },
): Promise<PaidBetaPaymentAttemptClaim> {
  try {
    return await beginPaidBetaPaymentAttempt(input)
  } catch (error) {
    if (!isPaidBetaPaymentUnavailableError(error)) throw error
    await releaseProviderTerminalAttempts()
    return beginPaidBetaPaymentAttempt(input)
  }
}
