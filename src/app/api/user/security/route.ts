import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import {
  ACCOUNT_SECURITY_RESULT_CODES,
  getAccountSecurity,
  setInitialPassword,
} from '@/lib/auth/account-security'
import { apiHandler, ApiError } from '@/lib/api-errors'

const setPasswordSchema = z.object({
  password: z.string().min(1),
})

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const security = await getAccountSecurity(authResult.session.user.id)

  return NextResponse.json({
    success: true,
    security,
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: ACCOUNT_SECURITY_RESULT_CODES.bodyParseFailed,
      field: 'body',
    })
  }

  const parsed = setPasswordSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: ACCOUNT_SECURITY_RESULT_CODES.passwordPayloadInvalid,
      field: 'password',
    })
  }

  const security = await setInitialPassword({
    userId: authResult.session.user.id,
    password: parsed.data.password,
  })

  return NextResponse.json({
    success: true,
    security,
  })
})
