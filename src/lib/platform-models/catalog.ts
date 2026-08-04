import { composeModelKey } from '@/lib/ai-registry/selection'
import type { UnifiedModelType } from '@/lib/ai-registry/types'
import {
  PLATFORM_DEFAULT_MODEL_KEYS,
  PLATFORM_MODEL_INPUTS,
  PLATFORM_USER_MODEL_KEYS,
  type PlatformDefaultModelField,
  type PlatformUserModelCategory,
} from '@/lib/ai-registry/platform-models'
import type { DefaultModelsPayload, StoredModel } from '@/lib/user-api/api-config-types'
import type { PlatformModelPreset } from './types'

const PLATFORM_DEFAULT_MODEL_TYPES: Record<PlatformDefaultModelField, UnifiedModelType> = {
  assistantModel: 'llm',
  analysisModel: 'llm',
  characterModel: 'image',
  locationModel: 'image',
  editModel: 'image',
  videoModel: 'video',
  musicModel: 'music',
}

const PLATFORM_DEFAULT_MODEL_ENV: Record<PlatformDefaultModelField, string> = {
  assistantModel: 'PLATFORM_DEFAULT_ASSISTANT_MODEL',
  analysisModel: 'PLATFORM_DEFAULT_ANALYSIS_MODEL',
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

export function getPlatformUserSelectableModels(): StoredModel[] {
  const modelsByKey = new Map(getPlatformModels().map((model) => [model.modelKey, model]))
  return Object.values(PLATFORM_USER_MODEL_KEYS).flatMap((modelKeys) => modelKeys.map((modelKey) => {
    const model = modelsByKey.get(modelKey)
    if (!model) throw new Error(`PLATFORM_USER_MODEL_NOT_FOUND: ${modelKey}`)
    return model
  }))
}

export function assertPlatformUserModelKey(
  category: PlatformUserModelCategory,
  modelKey: string,
): string {
  const normalized = modelKey.trim()
  if (!(PLATFORM_USER_MODEL_KEYS[category] as readonly string[]).includes(normalized)) {
    throw new Error(`PLATFORM_USER_MODEL_NOT_ALLOWED: ${category}=${normalized || '<empty>'}`)
  }
  return normalized
}

export type PlatformUserModelPreferences = Pick<Required<DefaultModelsPayload>,
  | 'assistantModel'
  | 'characterModel'
  | 'locationModel'
  | 'editModel'
  | 'videoModel'
>

type PlatformUserModelPreferenceInput = {
  [Field in keyof PlatformUserModelPreferences]?: string | null
}

function resolveOptionalPlatformUserModelKey(input: {
  category: PlatformUserModelCategory
  value: string | null | undefined
  fallback: string
  field: string
}): string {
  if (input.value === null || input.value === undefined) {
    return assertPlatformUserModelKey(input.category, input.fallback)
  }
  if (typeof input.value !== 'string' || !input.value.trim()) {
    throw new Error(`PLATFORM_USER_MODEL_PREFERENCE_INVALID: ${input.field}`)
  }
  return assertPlatformUserModelKey(input.category, input.value)
}

export function resolvePlatformUserModelPreferences(input?: PlatformUserModelPreferenceInput): PlatformUserModelPreferences {
  const defaults = getPlatformDefaultModels()
  if (
    defaults.characterModel !== defaults.locationModel
    || defaults.characterModel !== defaults.editModel
  ) {
    throw new Error('PLATFORM_DEFAULT_IMAGE_MODELS_MUST_MATCH')
  }
  const assistantModel = resolveOptionalPlatformUserModelKey({
    category: 'llm',
    value: input?.assistantModel,
    fallback: defaults.assistantModel,
    field: 'assistantModel',
  })
  const imageValues = [input?.characterModel, input?.locationModel, input?.editModel]
  const populatedImageValues = imageValues.filter((value): value is string => value !== null && value !== undefined)
  if (
    populatedImageValues.length !== 0
    && (
      populatedImageValues.length !== imageValues.length
      || new Set(populatedImageValues).size !== 1
    )
  ) {
    throw new Error('PLATFORM_USER_IMAGE_MODEL_PREFERENCE_MUST_MATCH')
  }
  const imageModel = resolveOptionalPlatformUserModelKey({
    category: 'image',
    value: populatedImageValues[0],
    fallback: defaults.characterModel,
    field: 'imageModel',
  })
  const videoModel = resolveOptionalPlatformUserModelKey({
    category: 'video',
    value: input?.videoModel,
    fallback: defaults.videoModel,
    field: 'videoModel',
  })
  return {
    assistantModel,
    characterModel: imageModel,
    locationModel: imageModel,
    editModel: imageModel,
    videoModel,
  }
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
