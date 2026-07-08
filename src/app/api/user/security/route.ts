import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import {
  ACCOUNT_SECURITY_RESULT_CODES,
  getAccountSecurity,
  setAccountPassword,
} from '@/lib/auth/account-security'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'

const setPasswordSchema = z.object({
  password: z.string().min(1),
  currentPassword: z.string().optional(),
})

function requireAccountSecurityFeature(): void {
  const features = getDeploymentFeatures(getDeploymentConfig())
  if (!features.showAccountSecurity) {
    throw new ApiError('NOT_FOUND', {
      code: 'ACCOUNT_SECURITY_FEATURE_DISABLED',
      message: 'ACCOUNT_SECURITY_FEATURE_DISABLED',
    })
  }
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  requireAccountSecurityFeature()

  const security = await getAccountSecurity(authResult.session.user.id)

  return NextResponse.json({
    success: true,
    security,
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  requireAccountSecurityFeature()

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

  const security = await setAccountPassword({
    userId: authResult.session.user.id,
    password: parsed.data.password,
    currentPassword: parsed.data.currentPassword,
  })

  return NextResponse.json({
    success: true,
    security,
  })
})
