import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import {
  createWechatPlanIntent,
  createWechatRechargeIntent,
} from '@/lib/payments/stripe-wechat-intent'
import { isPaymentConfigurationError, readPaymentConfigurationErrorCode } from '@/lib/payments/config-errors'

/**
 * Either a credit top-up or a plan term — both are one-off WeChat payments and
 * differ only in what the webhook does when the scan clears.
 */
const wechatIntentSchema = z.union([
  z.object({ kind: z.literal('recharge'), credits: z.number().int().positive() }),
  z.object({
    kind: z.literal('plan'),
    planId: z.enum(['starter', 'creator', 'pro', 'studio', 'flagship']),
    interval: z.enum(['month', 'year']),
  }),
])

/**
 * POST /api/payments/stripe/wechat/intent
 *
 * Returns a client secret the browser confirms to obtain a WeChat QR code. The
 * balance is not touched here — only the webhook credits it, so a user who
 * abandons the QR is never charged and never credited.
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

  const parsed = wechatIntentSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PAYMENT_CHECKOUT_PAYLOAD_INVALID',
      field: 'kind',
    })
  }

  let intent: { paymentIntentId: string; clientSecret: string; amountCny: number }
  try {
    if (parsed.data.kind === 'plan') {
      const planIntent = await createWechatPlanIntent({
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
      const rechargeIntent = await createWechatRechargeIntent({
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
    if (isPaymentConfigurationError(error)) {
      const code = readPaymentConfigurationErrorCode(error)
      throw new ApiError('MISSING_CONFIG', { code, message: code })
    }
    throw error
  }

  return NextResponse.json({
    success: true,
    paymentIntentId: intent.paymentIntentId,
    clientSecret: intent.clientSecret,
    amountCny: intent.amountCny,
  })
})
