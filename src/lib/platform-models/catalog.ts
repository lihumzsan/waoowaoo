import { composeModelKey } from '@/lib/ai-registry/selection'
import type { UnifiedModelType } from '@/lib/ai-registry/types'
import { ARK_DEFAULT_GROUP_VIDEO_MODEL, ARK_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/ark/models'
import { FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY, FAL_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/fal/models'
import {
  GOOGLE_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
  GOOGLE_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  GOOGLE_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/google/models'
import type { DefaultModelsPayload, StoredModel } from '@/lib/user-api/api-config-types'
import type { PlatformModelPreset } from './types'

export type PlatformDefaultModelField = keyof Required<DefaultModelsPayload>

const PLATFORM_DEFAULT_MODEL_TYPES: Record<PlatformDefaultModelField, UnifiedModelType> = {
  analysisModel: 'llm',
  characterModel: 'image',
  locationModel: 'image',
  storyboardModel: 'image',
  editModel: 'image',
  videoModel: 'video',
  musicModel: 'music',
}

const PLATFORM_DEFAULT_MODEL_ENV: Record<PlatformDefaultModelField, string> = {
  analysisModel: 'PLATFORM_DEFAULT_ANALYSIS_MODEL',
  characterModel: 'PLATFORM_DEFAULT_CHARACTER_MODEL',
  locationModel: 'PLATFORM_DEFAULT_LOCATION_MODEL',
  storyboardModel: 'PLATFORM_DEFAULT_STORYBOARD_MODEL',
  editModel: 'PLATFORM_DEFAULT_EDIT_MODEL',
  videoModel: 'PLATFORM_DEFAULT_VIDEO_MODEL',
  musicModel: 'PLATFORM_DEFAULT_MUSIC_MODEL',
}

const PLATFORM_MODEL_INPUTS: readonly PlatformModelPreset[] = [
  ...GOOGLE_PLATFORM_MODEL_PRESETS,
  ...FAL_PLATFORM_MODEL_PRESETS,
  ...ARK_PLATFORM_MODEL_PRESETS,
]

export const PLATFORM_DEFAULT_MODEL_KEYS: Record<PlatformDefaultModelField, string> = {
  analysisModel: GOOGLE_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
  characterModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  locationModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  storyboardModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  editModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  videoModel: ARK_DEFAULT_GROUP_VIDEO_MODEL,
  musicModel: GOOGLE_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
}

function toPlatformModel(input: PlatformModelPreset): StoredModel {
  return {
    modelId: input.modelId,
    modelKey: composeModelKey(input.provider, input.modelId),
    name: input.name,
    type: input.type,
    provider: input.provider,
    price: 0,
  }
}

function readEnvModelKey(field: PlatformDefaultModelField): string | null {
  const raw = process.env[PLATFORM_DEFAULT_MODEL_ENV[field]]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed || null
}

export function getPlatformModels(): StoredModel[] {
  return PLATFORM_MODEL_INPUTS.map(toPlatformModel)
}

export function getPlatformDefaultModels(): Required<DefaultModelsPayload> {
  const models = getPlatformModels()
  const byKey = new Map(models.map((model) => [model.modelKey, model]))
  const defaults = {} as Required<DefaultModelsPayload>

  for (const field of Object.keys(PLATFORM_DEFAULT_MODEL_KEYS) as PlatformDefaultModelField[]) {
    const modelKey = readEnvModelKey(field) || PLATFORM_DEFAULT_MODEL_KEYS[field]
    const model = byKey.get(modelKey)
    if (!model) {
      throw new Error(`PLATFORM_DEFAULT_MODEL_NOT_FOUND: ${field}=${modelKey}`)
    }
    const expectedType = PLATFORM_DEFAULT_MODEL_TYPES[field]
    if (model.type !== expectedType) {
      throw new Error(`PLATFORM_DEFAULT_MODEL_TYPE_INVALID: ${field}=${modelKey} expected ${expectedType}`)
    }
    defaults[field] = modelKey
  }

  return defaults
}
