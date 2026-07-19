import type {
  AiOptionObjectValidator,
  AiOptionSchema,
  AiOptionValidationResult,
  AiOptionValidator,
} from '@/lib/ai-registry/types'

export type MediaModality = 'image' | 'video' | 'music'

export function enumValidator(values: readonly string[]): AiOptionValidator {
  const allowedValues = new Set(values)
  return (value) => {
    if (value === undefined) return { ok: true }
    if (typeof value !== 'string') return { ok: false, reason: 'expected_string' }
    return allowedValues.has(value)
      ? { ok: true }
      : { ok: false, reason: `unsupported_value=${value}` }
  }
}

export function integerRangeValidator(input: { min?: number; max?: number }): AiOptionValidator {
  return (value) => {
    if (value === undefined) return { ok: true }
    if (typeof value !== 'number' || !Number.isInteger(value)) return { ok: false, reason: 'expected_integer' }
    if (input.min !== undefined && value < input.min) return { ok: false, reason: `min=${input.min}` }
    if (input.max !== undefined && value > input.max) return { ok: false, reason: `max=${input.max}` }
    return { ok: true }
  }
}

export function numberRangeValidator(input: { min?: number; max?: number }): AiOptionValidator {
  return (value) => {
    if (value === undefined) return { ok: true }
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'expected_finite_number' }
    if (input.min !== undefined && value < input.min) return { ok: false, reason: `min=${input.min}` }
    if (input.max !== undefined && value > input.max) return { ok: false, reason: `max=${input.max}` }
    return { ok: true }
  }
}

export function booleanValidator(): AiOptionValidator {
  return (value) => {
    if (value === undefined) return { ok: true }
    return typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'expected_boolean' }
  }
}

export function nonEmptyStringValidator(): AiOptionValidator {
  return (value) => {
    if (value === undefined) return { ok: true }
    return typeof value === 'string' && value.trim().length > 0
      ? { ok: true }
      : { ok: false, reason: 'expected_non_empty_string' }
  }
}

export function stringArrayValidator(input?: { maxLength?: number }): AiOptionValidator {
  return (value) => {
    if (value === undefined) return { ok: true }
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      return { ok: false, reason: 'expected_non_empty_string_array' }
    }
    if (input?.maxLength !== undefined && value.length > input.maxLength) {
      return { ok: false, reason: `max_length=${input.maxLength}` }
    }
    return { ok: true }
  }
}

function passthroughValidator(): AiOptionValidationResult {
  return { ok: true }
}

export function buildMediaOptionSchema(
  modality: MediaModality,
  override?: {
    allowedKeys?: readonly string[]
    excludedKeys?: readonly string[]
    required?: readonly string[]
    requiresOneOf?: AiOptionSchema['requiresOneOf']
    conflicts?: AiOptionSchema['conflicts']
    validators?: Readonly<Record<string, AiOptionValidator>>
    objectValidators?: readonly AiOptionObjectValidator[]
    normalize?: AiOptionSchema['normalize']
  },
): AiOptionSchema {
  const allowedKeys = new Set([
    ...Array.from(buildAllowedKeys(modality)),
    ...(override?.allowedKeys || []),
  ])
  for (const key of override?.excludedKeys || []) allowedKeys.delete(key)
  const validators = Object.fromEntries(
    Array.from(allowedKeys).map((key) => [key, passthroughValidator]),
  ) as Record<string, AiOptionValidator>
  for (const [key, validator] of Object.entries(override?.validators || {})) {
    validators[key] = validator
  }
  return {
    allowedKeys,
    required: override?.required,
    requiresOneOf: override?.requiresOneOf,
    conflicts: override?.conflicts,
    validators,
    objectValidators: override?.objectValidators,
    normalize: override?.normalize,
  }
}

function buildAllowedKeys(modality: MediaModality): ReadonlySet<string> {
  if (modality === 'image') {
    return new Set([
      'provider',
      'modelId',
      'modelKey',
      'referenceImages',
      'aspectRatio',
      'resolution',
      'outputFormat',
      'keepOriginalAspectRatio',
      'size',
      'quality',
      'responseFormat',
    ])
  }
  if (modality === 'video') {
    return new Set([
      'provider',
      'modelId',
      'modelKey',
      'prompt',
      'duration',
      'fps',
      'resolution',
      'aspectRatio',
      'generateAudio',
      'lastFrameImageUrl',
      'size',
      'promptExtend',
      'serviceTier',
      'executionExpiresAfter',
      'returnLastFrame',
      'draft',
      'seed',
      'cameraFixed',
      'watermark',
    ])
  }
  if (modality === 'music') {
    return new Set([
      'provider',
      'modelId',
      'modelKey',
      'negativePrompt',
      'durationSeconds',
      'vocalMode',
      'genre',
      'mood',
      'bpm',
      'outputFormat',
    ])
  }
  return new Set([
    'provider',
    'modelId',
    'modelKey',
    'durationSeconds',
    'loop',
    'promptInfluence',
    'outputFormat',
  ])
}

export function createFalVideoObjectValidator(modelId: string, modelIds: ReadonlySet<string>): AiOptionObjectValidator {
  return () => modelIds.has(modelId) ? { ok: true } : { ok: false, reason: `modelId=${modelId}` }
}
