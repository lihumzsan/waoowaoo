import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  subscriptionIntervalSchema,
  subscriptionPlanIdSchema,
} from '@/lib/billing/subscription-plan-schema'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { isPaidBetaPaymentUnavailableError } from '@/lib/paid-beta/campaign'
import { isPaymentConfigurationError, readPaymentConfigurationErrorCode } from '@/lib/payments/config-errors'
import {
  createStripeWalletPlanIntent,
  createStripeWalletRechargeIntent,
} from '@/lib/payments/stripe-wallet-intent'
import { STRIPE_WALLET_METHOD_IDS } from '@/lib/payments/stripe-wallet-methods'

const walletMethodSchema = z.enum(STRIPE_WALLET_METHOD_IDS)
const walletIntentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('recharge'),
    method: walletMethodSchema,
    credits: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('plan'),
    method: walletMethodSchema,
    planId: subscriptionPlanIdSchema,
    interval: subscriptionIntervalSchema,
  }),
])

/**
 * Create a one-off Stripe wallet PaymentIntent. This route only validates and
 * delegates; balance and plan writes remain exclusively in the webhook.
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  if (!getDeploymentFeatures(getDeploymentConfig()).showRecharge) {
    throw new ApiError('NOT_FOUND', { code: 'PAYMENT_RECHARGE_DISABLED' })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'BODY_PARSE_FAILED', field: 'body' })
  }

  const parsed = walletIntentSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PAYMENT_CHECKOUT_PAYLOAD_INVALID',
      field: 'kind',
    })
  }

  let intent: { paymentIntentId: string; clientSecret: string; amountCny: number }
  try {
    if (parsed.data.kind === 'plan') {
      const planIntent = await createStripeWalletPlanIntent({
        method: parsed.data.method,
        userId: authResult.session.user.id,
        planId: parsed.data.planId,
        interval: parsed.data.interval,
      })
      intent = {
        paymentIntentId: planIntent.paymentIntentId,
        clientSecret: planIntent.clientSecret,
        amountCny: planIntent.amountCny,
      }
    } else {
      const rechargeIntent = await createStripeWalletRechargeIntent({
        method: parsed.data.method,
        userId: authResult.session.user.id,
        credits: parsed.data.credits,
      })
      intent = {
        paymentIntentId: rechargeIntent.paymentIntentId,
        clientSecret: rechargeIntent.clientSecret,
        amountCny: rechargeIntent.quote.paymentAmount,
      }
    }
  } catch (error) {
    if (isPaidBetaPaymentUnavailableError(error)) {
      throw new ApiError('PAID_BETA_SOLD_OUT', undefined, { cause: error })
    }
    if (isPaymentConfigurationError(error)) {
      const code = readPaymentConfigurationErrorCode(error)
      throw new ApiError('MISSING_CONFIG', { code, message: code }, { cause: error })
    }
    throw error
  }

  return NextResponse.json({ success: true, ...intent })
})
