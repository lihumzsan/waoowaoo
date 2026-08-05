import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { resolveCheckoutLocale, resolveCheckoutPublicOrigin } from '@/lib/payments/checkout-request'
import { createPlanPurchaseSession } from '@/lib/payments/stripe-plan-purchase'
import { isPaymentConfigurationError, readPaymentConfigurationErrorCode } from '@/lib/payments/config-errors'
import { isPaidBetaPaymentUnavailableError } from '@/lib/paid-beta/campaign'

const planPurchaseSchema = z.object({
  planId: z.enum(['starter', 'creator', 'pro', 'studio', 'flagship']),
  interval: z.enum(['month', 'year']),
})

/**
 * POST /api/payments/stripe/plan
 *
 * Starts a one-off Checkout for a plan term. The term is only created once the
 * webhook confirms payment, so abandoning Checkout leaves nothing behind.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  if (!getDeploymentFeatures(getDeploymentConfig()).showSubscription) {
    throw new ApiError('NOT_FOUND', { code: 'SUBSCRIPTION_NOT_AVAILABLE' })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'BODY_PARSE_FAILED', field: 'body' })
  }

  const parsed = planPurchaseSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PLAN_PURCHASE_PAYLOAD_INVALID',
      field: 'planId',
    })
  }

  let session: Awaited<ReturnType<typeof createPlanPurchaseSession>>
  try {
    session = await createPlanPurchaseSession({
      userId: authResult.session.user.id,
      email: authResult.session.user.email,
      locale: resolveCheckoutLocale(request),
      origin: resolveCheckoutPublicOrigin(request),
      planId: parsed.data.planId,
      interval: parsed.data.interval,
    })
  } catch (error) {
    if (isPaidBetaPaymentUnavailableError(error)) {
      throw new ApiError('PAID_BETA_SOLD_OUT')
    }
    if (isPaymentConfigurationError(error)) {
      const code = readPaymentConfigurationErrorCode(error)
      throw new ApiError('MISSING_CONFIG', { code, message: code })
    }
    throw error
  }

  return NextResponse.json({
    success: true,
    sessionId: session.id,
    url: session.url,
    planId: session.planId,
    interval: session.interval,
    priceCny: session.priceCny,
    monthlyCredits: session.monthlyCredits,
  })
})
