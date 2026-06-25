import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getProjectModelConfig, getUserModelConfig, type ProjectModelConfig } from '@/lib/config-service'
import { getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'

export type SystemModelPurpose =
  | 'analysis'
  | 'character-image'
  | 'location-image'
  | 'storyboard-image'
  | 'edit-image'
  | 'video'
  | 'single-shot-video'
  | 'sequence-video'
  | 'music'

function requireModel(modelKey: string | null | undefined, purpose: SystemModelPurpose): string {
  if (typeof modelKey === 'string' && modelKey.trim()) return modelKey.trim()
  throw new ApiError('INVALID_PARAMS', {
    code: 'SYSTEM_MODEL_REQUIRED',
    field: purpose,
  })
}

function resolvePlatformModel(purpose: SystemModelPurpose): string {
  if (purpose === 'single-shot-video' || purpose === 'sequence-video') {
    return getPlatformRuntimePlan('video').modelKey
  }
  return getPlatformRuntimePlan(purpose).modelKey
}

function isProjectModelConfig(
  config: Awaited<ReturnType<typeof getProjectModelConfig>> | Awaited<ReturnType<typeof getUserModelConfig>>,
): config is ProjectModelConfig {
  return 'singleShotVideoModel' in config && 'sequenceVideoModel' in config
}

function resolveProjectScopedVideoModel(
  config: Awaited<ReturnType<typeof getProjectModelConfig>> | Awaited<ReturnType<typeof getUserModelConfig>>,
  purpose: Extract<SystemModelPurpose, 'single-shot-video' | 'sequence-video'>,
): string | null {
  if (!isProjectModelConfig(config)) return config.videoModel
  if (purpose === 'single-shot-video') return config.singleShotVideoModel || config.videoModel
  return config.sequenceVideoModel || config.videoModel
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
    case 'single-shot-video':
    case 'sequence-video':
      return requireModel(resolveProjectScopedVideoModel(config, input.purpose), input.purpose)
    case 'music':
      return requireModel(config.musicModel, input.purpose)
  }
}
