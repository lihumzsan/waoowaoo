import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { createStripeClient } from '@/lib/payments/stripe-client'
import { isPaymentConfigurationError, readPaymentConfigurationErrorCode } from '@/lib/payments/config-errors'

/**
 * POST /api/payments/stripe/subscription/cancel
 *
 * Cancels at the end of the paid period, never immediately: the user paid for
 * this period and keeps its credits until it ends. Stripe owns the schedule —
 * this route only sets the flag and lets the resulting webhook update our row,
 * so the subscription's state has one writer.
 */
export const POST = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  if (!getDeploymentFeatures(getDeploymentConfig()).showSubscription) {
    throw new ApiError('NOT_FOUND', { code: 'SUBSCRIPTION_NOT_AVAILABLE' })
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: authResult.session.user.id },
  })
  if (!subscription) {
    throw new ApiError('NOT_FOUND', { code: 'SUBSCRIPTION_NOT_FOUND' })
  }

  try {
    await createStripeClient().subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    })
  } catch (error) {
    if (isPaymentConfigurationError(error)) {
      const code = readPaymentConfigurationErrorCode(error)
      throw new ApiError('MISSING_CONFIG', { code, message: code })
    }
    throw error
  }

  return NextResponse.json({
    success: true,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
  })
})
