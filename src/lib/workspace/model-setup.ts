import {
  PROJECT_VIDEO_RATIOS,
  type ProjectVideoRatio,
} from '@/lib/projects/video-ratio'

interface PreferenceRecord {
  analysisModel?: string | null
  videoRatio?: string | null
}

interface DeploymentRecord {
  providerCredentialMode?: string | null
  usesPlatformProviderKeys?: boolean | null
  isCloud?: boolean | null
}

interface RuntimeDefaultsRecord {
  analysisModel?: string | null
}

interface UserPreferencePayload {
  preference?: PreferenceRecord | null
  deployment?: DeploymentRecord | null
  runtimeDefaults?: RuntimeDefaultsRecord | null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function hasConfiguredAnalysisModel(payload: unknown): boolean {
  return readConfiguredAnalysisModel(payload) !== null
}

export function readConfiguredAnalysisModel(payload: unknown): string | null {
  if (!isObjectLike(payload)) return null

  const preferenceValue = payload.preference
  if (isObjectLike(preferenceValue)) {
    const preference = preferenceValue as PreferenceRecord
    if (isNonEmptyString(preference.analysisModel)) return preference.analysisModel.trim()
  }

  if (!usesPlatformProviderKeys(payload)) return null

  const runtimeDefaultsValue = payload.runtimeDefaults
  if (!isObjectLike(runtimeDefaultsValue)) return null

  const runtimeDefaults = runtimeDefaultsValue as RuntimeDefaultsRecord
  return isNonEmptyString(runtimeDefaults.analysisModel) ? runtimeDefaults.analysisModel.trim() : null
}

export function readConfiguredProjectVideoRatio(payload: unknown): ProjectVideoRatio | null {
  if (!isObjectLike(payload)) return null

  const preferenceValue = payload.preference
  if (!isObjectLike(preferenceValue)) return null

  const videoRatio = preferenceValue.videoRatio
  return PROJECT_VIDEO_RATIOS.some((ratio) => ratio === videoRatio)
    ? videoRatio as ProjectVideoRatio
    : null
}

export function usesPlatformProviderKeys(payload: unknown): boolean {
  if (!isObjectLike(payload)) return false

  const deploymentValue = payload.deployment
  if (!isObjectLike(deploymentValue)) return false

  const deployment = deploymentValue as DeploymentRecord
  if (deployment.usesPlatformProviderKeys === true) return true
  return deployment.providerCredentialMode === 'platform-key'
}

export function shouldGuideToModelSetup(payload: unknown): boolean {
  if (usesPlatformProviderKeys(payload)) return false
  if (!isObjectLike(payload)) return false
  const deploymentValue = payload.deployment
  if (!isObjectLike(deploymentValue) || deploymentValue.isCloud !== true) return false
  return !hasConfiguredAnalysisModel(payload)
}

export type { UserPreferencePayload }
