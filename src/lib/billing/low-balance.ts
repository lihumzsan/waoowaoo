import { SEEDANCE_2_RETAIL_CREDITS_PER_SECOND } from '@/lib/ai-providers/shared/seedance-pricing'

/**
 * When to warn a user that they are running low.
 *
 * The threshold is what one ordinary piece of work costs rather than a round
 * number, because that is the question a user actually has: "can I still make
 * another one?" A bare credit count means nothing without that reference.
 */

/** A standard clip: 10 seconds of 720p Seedance, the product's common unit. */
const REFERENCE_CLIP_SECONDS = 10

export const LOW_BALANCE_THRESHOLD_CREDITS =
  SEEDANCE_2_RETAIL_CREDITS_PER_SECOND.standard['720p'] * REFERENCE_CLIP_SECONDS

export type BalanceHealth = 'ok' | 'low' | 'empty'

export function resolveBalanceHealth(availableCredits: number): BalanceHealth {
  if (availableCredits <= 0) return 'empty'
  if (availableCredits < LOW_BALANCE_THRESHOLD_CREDITS) return 'low'
  return 'ok'
}

/**
 * How many standard clips the balance still covers. Feeds the warning copy so
 * it can say something concrete instead of just "low".
 */
export function referenceClipsRemaining(availableCredits: number): number {
  const perClip = LOW_BALANCE_THRESHOLD_CREDITS
  if (perClip <= 0) return 0
  return Math.floor(Math.max(0, availableCredits) / perClip)
}

/** Days before a plan term ends that the user starts being reminded. */
export const PLAN_EXPIRY_REMINDER_DAYS = 7

/**
 * How long a plan term still has to run.
 *
 * A term that was bought rather than auto-renewed simply stops, so the warning
 * has to arrive before it does — otherwise the first sign is work failing.
 */
export function daysUntilPlanEnds(currentPeriodEnd: Date, now: Date = new Date()): number {
  const remainingMs = currentPeriodEnd.getTime() - now.getTime()
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
}

export function isPlanExpiringSoon(currentPeriodEnd: Date, now: Date = new Date()): boolean {
  return daysUntilPlanEnds(currentPeriodEnd, now) <= PLAN_EXPIRY_REMINDER_DAYS
}
