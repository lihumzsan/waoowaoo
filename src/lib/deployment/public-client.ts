import type { DeploymentFeatures } from './features'

export type PublicDeploymentFeatures = DeploymentFeatures

const BOOLEAN_DEPLOYMENT_FEATURE_KEYS = [
  'showOfficialPublicPages',
  'showPricingPage',
  'showLegalPages',
  'showRecharge',
  'showSubscription',
  'showBilling',
  'showPublicBetaWaitlist',
  'showApiConfig',
  'showAccountSecurity',
  'showGoogleOAuth',
  'enablePhoneAuth',
  'enablePasswordAuth',
  'showDownloadLogs',
  'showUpdateCheck',
  'showBetaBadge',
] as const satisfies ReadonlyArray<keyof PublicDeploymentFeatures>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPublicDeploymentFeatures(value: unknown): value is PublicDeploymentFeatures {
  if (!isRecord(value)) return false
  if (!BOOLEAN_DEPLOYMENT_FEATURE_KEYS.every((key) => typeof value[key] === 'boolean')) {
    return false
  }
  return value.passwordAuthIdentity === 'username' || value.passwordAuthIdentity === 'phone'
}

export async function fetchPublicDeploymentFeatures(): Promise<PublicDeploymentFeatures | null> {
  try {
    const response = await fetch('/api/deployment', { cache: 'no-store' })
    if (!response.ok) return null

    const payload: unknown = await response.json()
    if (!isRecord(payload)) return null
    const features = payload.features
    if (!isPublicDeploymentFeatures(features)) return null
    return features
  } catch {
    return null
  }
}
