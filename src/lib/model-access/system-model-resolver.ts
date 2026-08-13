import { ApiError } from '@/lib/api-errors'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { PLATFORM_VOICEOVER_MODEL_KEY } from '@/lib/ai-registry/platform-models'

export type SystemModelPurpose =
  | 'analysis'
  | 'character-image'
  | 'location-image'
  | 'edit-image'
  | 'video'
  | 'music'
  | 'sound'
  | 'voiceover'

function requireModel(modelKey: string | null | undefined, purpose: SystemModelPurpose): string {
  if (typeof modelKey === 'string' && modelKey.trim()) return modelKey.trim()
  throw new ApiError('INVALID_PARAMS', {
    code: 'SYSTEM_MODEL_REQUIRED',
    field: purpose,
  })
}

export async function resolveSystemModelKey(input: {
  userId: string
  projectId?: string | null
  purpose: SystemModelPurpose
}): Promise<string> {
  if (input.purpose === 'voiceover') return PLATFORM_VOICEOVER_MODEL_KEY

  const config = input.projectId
    ? await getProjectModelConfig(input.projectId, input.userId)
    : await getUserModelConfig(input.userId)

  switch (input.purpose) {
    case 'analysis':
      throw new ApiError('INVALID_PARAMS', { code: 'SYSTEM_MODEL_REQUIRED', field: input.purpose })
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
    case 'sound':
      return requireModel(config.soundModel, input.purpose)
  }
}
