import { NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { buildSubscriptionPlanViews } from '@/lib/billing/subscription-plan-view'

/**
 * GET /api/payments/subscription/config
 *
 * The plan catalog as the pricing page needs it: prices, credit grants, the
 * implied bonus and the concurrency each plan unlocks, all derived server-side
 * from the same declaration billing uses. The client never recomputes a price.
 */
export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const features = getDeploymentFeatures(getDeploymentConfig())
  if (!features.showSubscription) {
    return NextResponse.json({ success: true, enabled: false, plans: [] })
  }

  return NextResponse.json({
    success: true,
    enabled: true,
    plans: buildSubscriptionPlanViews(),
  })
})
