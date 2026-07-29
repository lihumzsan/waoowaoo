import type { DeploymentFeatures } from './features'
import { isSmsDestinationId } from '@/lib/auth/sms-destinations'

export type PublicDeploymentFeatures = DeploymentFeatures

const BOOLEAN_DEPLOYMENT_FEATURE_KEYS: Array<
  Exclude<keyof PublicDeploymentFeatures, 'smsDestinationIds'>
> = [
  'showOfficialPublicPages',
  'showPricingPage',
  'showLegalPages',
  'showRecharge',
  'showInviteCode',
  'showBilling',
  'showApiConfig',
  'showAccountSecurity',
  'showGoogleOAuth',
  'enablePhoneAuth',
  'enablePasswordAuth',
  'showDownloadLogs',
  'showUpdateCheck',
  'requireInviteCodeOnSignup',
  'usePlatformProviderConfig',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPublicDeploymentFeatures(value: unknown): value is PublicDeploymentFeatures {
  if (!isRecord(value)) return false
  if (!BOOLEAN_DEPLOYMENT_FEATURE_KEYS.every((key) => typeof value[key] === 'boolean')) {
    return false
  }
  return Array.isArray(value.smsDestinationIds)
    && value.smsDestinationIds.every(isSmsDestinationId)
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
