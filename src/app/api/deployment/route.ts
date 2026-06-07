import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { getDeploymentConfig, toPublicDeploymentConfig } from '@/lib/deployment/config'
import { getBillingMode } from '@/lib/billing'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  return NextResponse.json({
    success: true,
    deployment: toPublicDeploymentConfig(getDeploymentConfig()),
    billingMode: await getBillingMode(),
  })
})
