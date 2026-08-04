import type { AiOptionSchema, AiOptionValidationResult, AiOptionValidator } from '@/lib/ai-registry/types'
import {
  REASONING_EFFORT_VALUES,
  type ReasoningEffort,
} from '@/lib/ai-registry/reasoning-effort'

function ok(): AiOptionValidationResult {
  return { ok: true }
}

function fail(reason: string): AiOptionValidationResult {
  return { ok: false, reason }
}

function passthroughValidator(): AiOptionValidationResult {
  return ok()
}

function booleanValidator(): AiOptionValidator {
  return (value) => {
    if (value === undefined) return ok()
    return typeof value === 'boolean' ? ok() : fail('expected_boolean')
  }
}

function nonEmptyStringValidator(): AiOptionValidator {
  return (value) => {
    if (value === undefined) return ok()
    if (typeof value !== 'string') return fail('expected_string')
    return value.trim().length > 0 ? ok() : fail('expected_non_empty_string')
  }
}

function integerRangeValidator(input: { min?: number; max?: number }): AiOptionValidator {
  return (value) => {
    if (value === undefined) return ok()
    if (typeof value !== 'number' || !Number.isInteger(value)) return fail('expected_integer')
    if (input.min !== undefined && value < input.min) return fail(`min=${input.min}`)
    if (input.max !== undefined && value > input.max) return fail(`max=${input.max}`)
    return ok()
  }
}

function enumValidator(values: readonly string[]): AiOptionValidator {
  const allowed = new Set(values)
  return (value) => {
    if (value === undefined) return ok()
    if (typeof value !== 'string') return fail('expected_string')
    return allowed.has(value) ? ok() : fail(`unsupported_value=${value}`)
  }
}

const LLM_ALLOWED_KEYS = [
  'reasoning',
  'reasoningEffort',
  'projectId',
  'action',
  'streamStepId',
  'streamStepAttempt',
  'streamStepTitle',
  'streamStepIndex',
  'streamStepTotal',
  '__skipAutoStream',
 ] as const

export function buildLlmOptionSchema(
  reasoningEffortOptions: readonly ReasoningEffort[] = REASONING_EFFORT_VALUES,
): AiOptionSchema {
  const allowedKeys = new Set<string>(LLM_ALLOWED_KEYS)
  const validators = Object.fromEntries(
    Array.from(allowedKeys).map((key) => [key, passthroughValidator]),
  ) as Record<string, AiOptionValidator>

  validators.reasoning = booleanValidator()
  validators.reasoningEffort = enumValidator(reasoningEffortOptions)

  validators.projectId = nonEmptyStringValidator()
  validators.action = nonEmptyStringValidator()
  validators.streamStepId = nonEmptyStringValidator()
  validators.streamStepTitle = nonEmptyStringValidator()
  validators.streamStepAttempt = integerRangeValidator({ min: 0 })
  validators.streamStepIndex = integerRangeValidator({ min: 0 })
  validators.streamStepTotal = integerRangeValidator({ min: 0 })
  validators.__skipAutoStream = booleanValidator()

  return {
    allowedKeys,
    validators,
  }
}
