import { NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { getDeploymentConfig, toPublicDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures, toPublicDeploymentFeatures } from '@/lib/deployment/features'
import { getBillingMode } from '@/lib/billing'

export const GET = apiHandler(async () => {
  const deployment = getDeploymentConfig()
  const features = getDeploymentFeatures(deployment)

  return NextResponse.json({
    success: true,
    deployment: toPublicDeploymentConfig(deployment),
    features: toPublicDeploymentFeatures(features),
    billingMode: await getBillingMode(),
  })
})
