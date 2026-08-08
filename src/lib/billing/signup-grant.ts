import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'

/**
 * Credits granted to a new account.
 *
 * Configurable rather than fixed because it is a growth lever, not a product
 * constant: the right number depends on what a first generation costs and how
 * much abuse the signup flow attracts. Zero disables it.
 *
 * Only cloud grants anything — a self-hosted deployment has no platform
 * balance to give away.
 */
const DEFAULT_SIGNUP_GRANT_CREDITS = 0

export function resolveSignupGrantCredits(): number {
  if (!getDeploymentFeatures(getDeploymentConfig()).showBilling) return 0

  const raw = process.env.SIGNUP_GRANT_CREDITS
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_SIGNUP_GRANT_CREDITS

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('SIGNUP_GRANT_CREDITS_INVALID')
  }
  return value
}
