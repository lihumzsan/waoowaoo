import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import {
  consumeImageCaptcha,
  ImageCaptchaError,
} from '@/lib/auth/image-captcha'
import { PHONE_AUTH_RESULT_CODES } from '@/lib/auth/phone-auth-contract'
import {
  PhoneVerificationError,
  requirePhoneAuthEnabled,
  sendPhoneVerificationCode,
} from '@/lib/auth/phone-verification'
import { logAuthAction } from '@/lib/logging/semantic'
import {
  AUTH_SMS_SEND_LIMIT,
  checkRateLimit,
  getClientIp,
} from '@/lib/rate-limit'

function errorResponse(error: PhoneVerificationError): NextResponse {
  const status = error.code === PHONE_AUTH_RESULT_CODES.featureDisabled
    ? 404
    : error.code === PHONE_AUTH_RESULT_CODES.invalidPhone
      ? 400
      : error.code === PHONE_AUTH_RESULT_CODES.sendRateLimited
        ? 429
        : 503
  const headers = error.retryAfterSeconds
    ? { 'Retry-After': String(error.retryAfterSeconds) }
    : undefined
  return NextResponse.json(
    {
      success: false,
      code: error.code,
      retryAfterSeconds: error.retryAfterSeconds,
    },
    { status, headers },
  )
}

export const POST = apiHandler(async (request: NextRequest) => {
  try {
    requirePhoneAuthEnabled()
  } catch (error) {
    if (error instanceof PhoneVerificationError) return errorResponse(error)
    throw error
  }

  const ip = getClientIp(request)
  const rateResult = await checkRateLimit('auth:phone:send', ip, AUTH_SMS_SEND_LIMIT)
  if (rateResult.limited) {
    logAuthAction('LOGIN', 'SMS send rate limited', { success: false, provider: 'phone', ip })
    return NextResponse.json(
      {
        success: false,
        code: PHONE_AUTH_RESULT_CODES.sendRateLimited,
        retryAfterSeconds: rateResult.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rateResult.retryAfterSeconds) },
      },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        success: false,
        code: PHONE_AUTH_RESULT_CODES.bodyParseFailed,
      },
      { status: 400 },
    )
  }

  const phoneNumber = body && typeof body === 'object' && !Array.isArray(body)
    ? Reflect.get(body, 'phoneNumber')
    : null
  const captchaId = body && typeof body === 'object' && !Array.isArray(body)
    ? Reflect.get(body, 'captchaId')
    : null
  const captchaAnswer = body && typeof body === 'object' && !Array.isArray(body)
    ? Reflect.get(body, 'captchaAnswer')
    : null

  try {
    await consumeImageCaptcha({
      captchaId,
      answer: captchaAnswer,
      clientIdentity: ip,
    })
  } catch (error) {
    if (error instanceof ImageCaptchaError) {
      return NextResponse.json(
        {
          success: false,
          code: error.code,
        },
        { status: error.code === PHONE_AUTH_RESULT_CODES.humanVerificationInvalid ? 400 : 503 },
      )
    }
    throw error
  }

  try {
    const result = await sendPhoneVerificationCode(phoneNumber)
    return NextResponse.json({
      success: true,
      code: PHONE_AUTH_RESULT_CODES.codeSent,
      retryAfterSeconds: result.retryAfterSeconds,
    })
  } catch (error) {
    if (error instanceof PhoneVerificationError) return errorResponse(error)
    throw error
  }
})
