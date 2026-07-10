import { describe, expect, it } from 'vitest'
import { ERROR_FAILURE_CLASS } from '@/lib/errors/codes'
import { shouldRetryTaskFailure } from '@/lib/task/retry-policy'
import { TASK_TYPE } from '@/lib/task/types'

describe('task retry policy', () => {
  it('retries LLM output validation failures', () => {
    expect(shouldRetryTaskFailure({
      taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
      failureClass: ERROR_FAILURE_CLASS.OUTPUT_VALIDATION,
    })).toBe(true)
  })

  it('does not retry output validation failures from non-LLM tasks', () => {
    expect(shouldRetryTaskFailure({
      taskType: TASK_TYPE.IMAGE_PANEL,
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
