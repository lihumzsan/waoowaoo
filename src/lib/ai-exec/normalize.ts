import type { AiOptionSchema, AiUnknownObject } from '@/lib/ai-registry/types'

interface NormalizedOptionObject {
  [key: string]: unknown
}

export type AiOptionValidationFailure =
  | 'invalid_options'
  | 'unsupported_option'
  | 'required_option'
  | 'conflicting_options'
  | 'invalid_option'

export class AiOptionValidationError extends Error {
  readonly failure: AiOptionValidationFailure
  readonly context: string
  readonly field: string | null
  readonly reason: string | null

  constructor(input: {
    failure: AiOptionValidationFailure
    context: string
    field?: string
    reason?: string
  }) {
    const detail = [input.context, input.field, input.reason].filter(Boolean).join(':')
    super(`AI_OPTION_VALIDATION_FAILED:${input.failure}:${detail}`)
    this.name = 'AiOptionValidationError'
    this.failure = input.failure
    this.context = input.context
    this.field = input.field ?? null
    this.reason = input.reason ?? null
  }
}

function isRecord(value: unknown): value is NormalizedOptionObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeAiOptions(input: {
  schema: AiOptionSchema
  options: unknown
  context: string
}): AiUnknownObject | undefined {
  const hasOptions = input.options !== undefined && input.options !== null
  if (hasOptions && !isRecord(input.options)) {
    throw new AiOptionValidationError({ failure: 'invalid_options', context: input.context })
  }
  const options = hasOptions ? input.options as NormalizedOptionObject : {}
  for (const key of Object.keys(options)) {
    if (!input.schema.allowedKeys.has(key)) {
      throw new AiOptionValidationError({
        failure: 'unsupported_option',
        context: input.context,
        field: key,
      })
    }
  }
  for (const requiredKey of input.schema.required || []) {
    const value = options[requiredKey]
    if (value === undefined || value === null || value === '') {
      throw new AiOptionValidationError({
        failure: 'required_option',
        context: input.context,
        field: requiredKey,
      })
    }
  }
  for (const oneOf of input.schema.requiresOneOf || []) {
    const hasValue = oneOf.keys.some((key) => {
      const value = options[key]
      return value !== undefined && value !== null && value !== ''
    })
    if (!hasValue) {
      throw new AiOptionValidationError({
        failure: 'required_option',
        context: input.context,
        reason: oneOf.message,
      })
    }
  }
  for (const conflict of input.schema.conflicts || []) {
    const presentKeys = conflict.keys.filter((key) => {
      const value = options[key]
      return value !== undefined && value !== null && value !== ''
    })
    if (presentKeys.length > 1) {
      if (conflict.allowSameValue) {
        const firstValue = options[presentKeys[0]]
        const hasDifferentValue = presentKeys.some((key) => options[key] !== firstValue)
        if (!hasDifferentValue) continue
      }
      throw new AiOptionValidationError({
        failure: 'conflicting_options',
        context: input.context,
        reason: conflict.message,
      })
    }
  }
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue
    const validator = input.schema.validators[key]
    if (!validator) continue
    const result = validator(value)
    if (!result.ok) {
      throw new AiOptionValidationError({
        failure: 'invalid_option',
        context: input.context,
        field: key,
        reason: result.reason,
      })
    }
  }
  for (const validator of input.schema.objectValidators || []) {
    const result = validator(options)
    if (!result.ok) {
      throw new AiOptionValidationError({
        failure: 'invalid_option',
        context: input.context,
        reason: result.reason,
      })
    }
  }
  if (input.schema.normalize) return input.schema.normalize(options)
  return hasOptions ? { ...options } : undefined
}
