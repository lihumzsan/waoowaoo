import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { getDeploymentConfig, toPublicDeploymentConfig } from '@/lib/deployment/config'
import { getBillingMode } from '@/lib/billing'

export const GET = apiHandler(async () => {
  return NextResponse.json({
    success: true,
    deployment: toPublicDeploymentConfig(getDeploymentConfig()),
    billingMode: await getBillingMode(),
  })
})
