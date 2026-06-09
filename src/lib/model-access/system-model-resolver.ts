import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getPlatformDefaultModels } from '@/lib/platform-models/catalog'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'

export type SystemModelPurpose =
  | 'analysis'
  | 'character-image'
  | 'location-image'
  | 'storyboard-image'
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
  const defaults = getPlatformDefaultModels()
  switch (purpose) {
    case 'analysis':
      return defaults.analysisModel
    case 'character-image':
      return defaults.characterModel
    case 'location-image':
      return defaults.locationModel
    case 'storyboard-image':
      return defaults.storyboardModel
    case 'edit-image':
      return defaults.editModel
    case 'video':
      return defaults.videoModel
    case 'music':
      return defaults.musicModel
  }
}

export async function resolveSystemModelKey(input: {
  userId: string
  projectId?: string | null
  purpose: SystemModelPurpose
}): Promise<string> {
  const deployment = getDeploymentConfig()
  if (deployment.edition === 'cloud') {
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
    case 'storyboard-image':
      return requireModel(config.storyboardModel, input.purpose)
    case 'edit-image':
      return requireModel(config.editModel, input.purpose)
    case 'video':
      return requireModel(config.videoModel, input.purpose)
    case 'music':
      return requireModel(config.musicModel, input.purpose)
  }
}
