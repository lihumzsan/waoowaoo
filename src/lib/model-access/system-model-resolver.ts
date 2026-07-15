import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig, isPlatformProviderCredentialMode } from '@/lib/deployment/config'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'

export type SystemModelPurpose =
  | 'analysis'
  | 'character-image'
  | 'location-image'
  | 'edit-image'
  | 'video'
  | 'music'

function requireModel(modelKey: string | null | undefined, purpose: SystemModelPurpose): string {
  if (typeof modelKey === 'string' && modelKey.trim()) return modelKey.trim()
  throw new ApiError('INVALID_PARAMS', {
    code: 'SYSTEM_MODEL_REQUIRED',
    field: purpose,
  })
}

function resolvePlatformModel(purpose: SystemModelPurpose): string {
  return getPlatformRuntimePlan(purpose).modelKey
}

export async function resolveSystemModelKey(input: {
  userId: string
  projectId?: string | null
  purpose: SystemModelPurpose
}): Promise<string> {
  const deployment = getDeploymentConfig()
  if (isPlatformProviderCredentialMode(deployment)) {
    return resolvePlatformModel(input.purpose)
  }

  const config = input.projectId
    ? await getProjectModelConfig(input.projectId, input.userId)
    : await getUserModelConfig(input.userId)

  switch (input.purpose) {
    case 'analysis':
      return requireModel(config.analysisModel, input.purpose)
    case 'character-image':
      return requireModel(config.characterModel, input.purpose)
    case 'location-image':
      return requireModel(config.locationModel, input.purpose)
    case 'edit-image':
      return requireModel(config.editModel, input.purpose)
    case 'video':
      return requireModel(config.videoModel, input.purpose)
    case 'music':
      return requireModel(config.musicModel, input.purpose)
  }
}
