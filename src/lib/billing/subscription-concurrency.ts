import { prisma } from '@/lib/prisma'
import { getBillingMode } from './mode'
import {
  FREE_TIER_CONCURRENCY,
  getSubscriptionPlan,
  isSubscriptionPlanId,
} from './subscription-plans'
import { isGrantingSubscriptionStatus } from './subscription-service'
import type { WorkflowConcurrencyConfig } from '@/lib/workflow-concurrency'

/**
 * How much work a user may run at once, by plan.
 *
 * Concurrency is the part of a plan that is not a discount: a higher tier runs
 * more generations in parallel rather than paying less per generation. That
 * makes upgrading worth something to a user who would otherwise be waiting,
 * without eroding margin.
 *
 * Only cloud enforces this. A self-hosted deployment pays its own provider
 * bills, so its concurrency is the operator's decision, not ours.
 */

export async function resolveSubscriptionConcurrencyCap(
  userId: string,
): Promise<WorkflowConcurrencyConfig | null> {
  if (await getBillingMode() !== 'ENFORCE') return null

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: { planId: true, status: true },
  })
  if (!subscription || !isGrantingSubscriptionStatus(subscription.status)) {
    return FREE_TIER_CONCURRENCY
  }
  if (!isSubscriptionPlanId(subscription.planId)) return FREE_TIER_CONCURRENCY
  return getSubscriptionPlan(subscription.planId).concurrency
}

/**
 * Apply the plan cap to a user's configured concurrency.
 *
 * The user's own setting still applies — it can only lower the limit, never
 * raise it past what their plan allows.
 */
export function capConcurrencyByPlan(
  requested: WorkflowConcurrencyConfig,
  cap: WorkflowConcurrencyConfig | null,
): WorkflowConcurrencyConfig {
  if (!cap) return requested
  return {
    analysis: Math.min(requested.analysis, cap.analysis),
    image: Math.min(requested.image, cap.image),
    video: Math.min(requested.video, cap.video),
  }
}
