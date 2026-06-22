import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { createStripeCheckoutSession } from '@/lib/payments/stripe-checkout'
import { isPaymentConfigurationError, readPaymentConfigurationErrorCode } from '@/lib/payments/config-errors'

const checkoutSchema = z.object({
  credits: z.number().positive(),
})

function resolveLocale(request: NextRequest): 'zh' | 'en' {
  const language = request.headers.get('accept-language') || ''
  return language.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

function resolvePublicOrigin(request: NextRequest): string {
  const configured = process.env.PAYMENT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim()
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PAYMENT_PUBLIC_BASE_URL_REQUIRED')
  }
  return request.nextUrl.origin
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'BODY_PARSE_FAILED',
      field: 'body',
    })
  }

  const parsed = checkoutSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PAYMENT_CHECKOUT_PAYLOAD_INVALID',
      field: 'credits',
    })
  }

  let session: Awaited<ReturnType<typeof createStripeCheckoutSession>>
  try {
    session = await createStripeCheckoutSession({
      userId: authResult.session.user.id,
      email: authResult.session.user.email,
      locale: resolveLocale(request),
      origin: resolvePublicOrigin(request),
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
    sessionId: session.id,
    url: session.url,
    quote: session.quote,
  })
})
