import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import {
  ImageCaptchaError,
  issueImageCaptcha,
} from '@/lib/auth/image-captcha'
import { PHONE_AUTH_RESULT_CODES } from '@/lib/auth/phone-auth-contract'
import {
  PhoneVerificationError,
  requirePhoneAuthEnabled,
} from '@/lib/auth/phone-verification'
import { logAuthAction } from '@/lib/logging/semantic'
import {
  AUTH_CAPTCHA_ISSUE_LIMIT,
  checkRateLimit,
  getClientIp,
} from '@/lib/rate-limit'

export const POST = apiHandler(async (request: NextRequest) => {
  try {
    requirePhoneAuthEnabled()
  } catch (error) {
    if (error instanceof PhoneVerificationError) {
      return NextResponse.json(
        { success: false, code: error.code },
        { status: error.code === PHONE_AUTH_RESULT_CODES.featureDisabled ? 404 : 503 },
      )
    }
    throw error
  }

  const ip = getClientIp(request)
  const rateResult = await checkRateLimit(
    'auth:phone:captcha:issue',
    ip,
    AUTH_CAPTCHA_ISSUE_LIMIT,
  )
  if (rateResult.limited) {
    logAuthAction('LOGIN', 'phone', { error: 'Image captcha issue rate limited', ip })
    return NextResponse.json(
      {
        success: false,
        code: PHONE_AUTH_RESULT_CODES.sendRateLimited,
        retryAfterSeconds: rateResult.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(rateResult.retryAfterSeconds),
        },
      },
    )
  }

  try {
    const captcha = await issueImageCaptcha(ip)
    return NextResponse.json(
      { success: true, ...captcha },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof ImageCaptchaError) {
      return NextResponse.json(
        { success: false, code: error.code },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        },
      )
    }
    throw error
  }
})
