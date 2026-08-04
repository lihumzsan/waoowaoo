import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getRechargeConfig } from '@/lib/payments/recharge-config'
import { isPaymentConfigurationError, readPaymentConfigurationErrorCode } from '@/lib/payments/config-errors'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  try {
    return NextResponse.json({
      success: true,
      recharge: getRechargeConfig(),
    })
  } catch (error) {
    if (isPaymentConfigurationError(error)) {
      const code = readPaymentConfigurationErrorCode(error)
      throw new ApiError('MISSING_CONFIG', { code, message: code })
    }
    throw error
  }
})
