import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import {
  ACCOUNT_SECURITY_RESULT_CODES,
  getAccountSecurity,
  setAccountPassword,
  updateAccountDisplayName,
} from '@/lib/auth/account-security'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'

const setPasswordSchema = z.object({
  password: z.string().min(1),
  currentPassword: z.string().optional(),
})

const updateDisplayNameSchema = z.object({
  displayName: z.string().min(1),
})

function readAccountSecurityFeatures() {
  const features = getDeploymentFeatures(getDeploymentConfig())
  if (!features.showAccountSecurity) {
    throw new ApiError('NOT_FOUND', {
      code: 'ACCOUNT_SECURITY_FEATURE_DISABLED',
      message: 'ACCOUNT_SECURITY_FEATURE_DISABLED',
    })
  }
  return features
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  readAccountSecurityFeatures()

  const security = await getAccountSecurity(authResult.session.user.id)

  return NextResponse.json({
    success: true,
    security,
  })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const features = readAccountSecurityFeatures()
  if (!features.enablePasswordAuth) {
    throw new ApiError('NOT_FOUND', {
      code: 'PASSWORD_AUTH_FEATURE_DISABLED',
      message: 'PASSWORD_AUTH_FEATURE_DISABLED',
    })
  }

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

export const PATCH = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  readAccountSecurityFeatures()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: ACCOUNT_SECURITY_RESULT_CODES.bodyParseFailed,
      field: 'body',
    })
  }

  const parsed = updateDisplayNameSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: ACCOUNT_SECURITY_RESULT_CODES.displayNamePayloadInvalid,
      field: 'displayName',
    })
  }

  const security = await updateAccountDisplayName({
    userId: authResult.session.user.id,
    displayName: parsed.data.displayName,
  })

  return NextResponse.json({
    success: true,
    security,
  })
})
