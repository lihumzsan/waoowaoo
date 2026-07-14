import { describe, expect, it } from 'vitest'
import { ERROR_FAILURE_CLASS, getErrorFailureClass } from '@/lib/errors/codes'
import { shouldRetryTaskFailure } from '@/lib/task/retry-policy'
import { TASK_TYPE } from '@/lib/task/types'

describe('task retry policy', () => {
  it('retries LLM output validation failures', () => {
    expect(shouldRetryTaskFailure({
      taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
      failureClass: getErrorFailureClass('MODEL_OUTPUT_SCHEMA_INVALID'),
    })).toBe(true)
  })

  it('classifies every unusable structured model result as output validation', () => {
    const outputErrorCodes = [
      'EMPTY_RESPONSE',
      'MODEL_OUTPUT_TRUNCATED',
      'PARSE_ERROR',
      'MODEL_OUTPUT_SCHEMA_INVALID',
      'PLAN_VALIDATION_FAILED',
    ] as const
    expect(outputErrorCodes.map((code) => getErrorFailureClass(code)))
      .toEqual(Array.from({ length: 5 }, () => ERROR_FAILURE_CLASS.OUTPUT_VALIDATION))
  })

  it('does not retry output validation failures from non-LLM tasks', () => {
    expect(shouldRetryTaskFailure({
      taskType: TASK_TYPE.IMAGE_CHARACTER,
      failureClass: ERROR_FAILURE_CLASS.OUTPUT_VALIDATION,
    })).toBe(false)
  })

  it('does not retry permanent LLM failures', () => {
    expect(shouldRetryTaskFailure({
      taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
      failureClass: ERROR_FAILURE_CLASS.PERMANENT_PROVIDER,
    })).toBe(false)
  })
})
