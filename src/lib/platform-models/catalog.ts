import { composeModelKey } from '@/lib/ai-registry/selection'
import type { UnifiedModelType } from '@/lib/ai-registry/types'
import {
  PLATFORM_DEFAULT_MODEL_KEYS,
  PLATFORM_MODEL_INPUTS,
  type PlatformDefaultModels,
  type PlatformDefaultModelField,
} from '@/lib/ai-registry/platform-models'
import type { StoredModel } from '@/lib/user-api/api-config-types'
import type { PlatformModelPreset } from './types'

const PLATFORM_DEFAULT_MODEL_TYPES: Record<PlatformDefaultModelField, UnifiedModelType> = {
  characterModel: 'image',
  locationModel: 'image',
  editModel: 'image',
  videoModel: 'video',
  musicModel: 'music',
}

const PLATFORM_DEFAULT_MODEL_ENV: Record<PlatformDefaultModelField, string> = {
  characterModel: 'PLATFORM_DEFAULT_CHARACTER_MODEL',
  locationModel: 'PLATFORM_DEFAULT_LOCATION_MODEL',
  editModel: 'PLATFORM_DEFAULT_EDIT_MODEL',
  videoModel: 'PLATFORM_DEFAULT_VIDEO_MODEL',
  musicModel: 'PLATFORM_DEFAULT_MUSIC_MODEL',
}

function toPlatformModel(input: PlatformModelPreset): StoredModel {
  return {
    modelId: input.modelId,
    modelKey: composeModelKey(input.provider, input.modelId),
    name: input.name,
    type: input.type,
    provider: input.provider,
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

export function getSelectableLocalVideoModels(): StoredModel[] {
  return getPlatformModels().filter((model) => (
    model.type === 'video' && model.provider === 'comfyui'
  ))
}

export function getPlatformDefaultModelCatalog(): StoredModel[] {
  const defaults = getPlatformDefaultModels()
  const modelsByKey = new Map(getPlatformModels().map((model) => [model.modelKey, model]))
  const modelKeys = Object.values(defaults).filter((modelKey): modelKey is string => (
    typeof modelKey === 'string' && modelKey.length > 0
  ))
  return [...new Set(modelKeys)].map((modelKey) => {
    const model = modelsByKey.get(modelKey)
    if (!model) throw new Error(`PLATFORM_DEFAULT_MODEL_NOT_FOUND: ${modelKey}`)
    return model
  })
}

export function getPlatformDefaultModels(): PlatformDefaultModels {
  const models = getPlatformModels()
  const byKey = new Map(models.map((model) => [model.modelKey, model]))
  const defaults = {} as Record<PlatformDefaultModelField, string>

  for (const field of Object.keys(PLATFORM_DEFAULT_MODEL_TYPES) as PlatformDefaultModelField[]) {
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
