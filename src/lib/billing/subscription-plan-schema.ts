import { z } from 'zod'
import {
  isSubscriptionInterval,
  isSubscriptionPlanId,
  type SubscriptionInterval,
  type SubscriptionPlanId,
} from './subscription-plans'

/** Shared request-boundary schemas backed by the production plan registry. */
export const subscriptionPlanIdSchema = z.custom<SubscriptionPlanId>(isSubscriptionPlanId)
export const subscriptionIntervalSchema = z.custom<SubscriptionInterval>(isSubscriptionInterval)
