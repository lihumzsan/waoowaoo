import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import {
  subscriptionIntervalSchema,
  subscriptionPlanIdSchema,
} from '@/lib/billing/subscription-plan-schema'
import { quotePlanPurchase } from '@/lib/payments/plan-purchase-quote'

const quoteSchema = z.object({
  planId: subscriptionPlanIdSchema,
  interval: subscriptionIntervalSchema,
})

/** Return the same authoritative quote card and WeChat checkout consume. */
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
  const parsed = quoteSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', { code: 'PLAN_PURCHASE_PAYLOAD_INVALID', field: 'planId' })
  }
  const quote = await quotePlanPurchase({
    userId: authResult.session.user.id,
    planId: parsed.data.planId,
    interval: parsed.data.interval,
  })
  return NextResponse.json({
    success: true,
    version: quote.version,
    amountCny: quote.amountCny,
    monthlyCredits: quote.monthlyCredits,
    promotionApplied: quote.promotionApplied,
  })
})
