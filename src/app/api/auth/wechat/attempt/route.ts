import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { createWechatOfficialAttempt } from '@/lib/auth/wechat-official-attempt'
import {
  WECHAT_OFFICIAL_RESULT_CODES,
  WechatOfficialError,
} from '@/lib/auth/wechat-official-config'
import {
  AUTH_WECHAT_ATTEMPT_LIMIT,
  checkRateLimit,
  getClientIp,
} from '@/lib/rate-limit'

const requestSchema = z.object({
  mode: z.enum(['login', 'bind']),
  locale: z.enum(['zh', 'en']),
})

function errorResponse(error: WechatOfficialError): NextResponse {
  const status = error.code === WECHAT_OFFICIAL_RESULT_CODES.featureDisabled
    ? 404
    : error.code === WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid
      ? 400
      : 503
  return NextResponse.json(
    { success: false, code: error.code },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const POST = apiHandler(async (request: NextRequest) => {
  const rateResult = await checkRateLimit(
    'auth:wechat-official:attempt',
    getClientIp(request),
    AUTH_WECHAT_ATTEMPT_LIMIT,
  )
  if (rateResult.limited) {
    return NextResponse.json(
      {
        success: false,
        code: 'WECHAT_OFFICIAL_RATE_LIMITED',
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, code: WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, code: WECHAT_OFFICIAL_RESULT_CODES.attemptInvalid },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  let targetUserId: string | undefined
  if (parsed.data.mode === 'bind') {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    targetUserId = authResult.session.user.id
  }

  try {
    const attempt = await createWechatOfficialAttempt({
      mode: parsed.data.mode,
      locale: parsed.data.locale,
      targetUserId,
    })
    return NextResponse.json(
      { success: true, attempt },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof WechatOfficialError) return errorResponse(error)
    throw error
  }
})
