import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { getRechargeConfig } from '@/lib/payments/recharge-config'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  return NextResponse.json({
    success: true,
    recharge: getRechargeConfig(),
  })
})
