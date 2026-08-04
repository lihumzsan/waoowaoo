import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { createWechatRechargeIntent } from '@/lib/payments/stripe-wechat-intent'
import { isPaymentConfigurationError, readPaymentConfigurationErrorCode } from '@/lib/payments/config-errors'

const wechatIntentSchema = z.object({
  credits: z.number().int().positive(),
})

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
      field: 'credits',
    })
  }

  let intent: Awaited<ReturnType<typeof createWechatRechargeIntent>>
  try {
    intent = await createWechatRechargeIntent({
      userId: authResult.session.user.id,
      credits: parsed.data.credits,
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
    paymentIntentId: intent.paymentIntentId,
    clientSecret: intent.clientSecret,
    quote: intent.quote,
  })
})
