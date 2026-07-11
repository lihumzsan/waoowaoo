import { describe, expect, it } from 'vitest'
import { resolveTaskErrorSummary } from '@/lib/task/error-message'

describe('task error localization boundary', () => {
  it('requires the caller locale boundary for provider error text', () => {
    const payload = { error: { code: 'PROVIDER_SUBMISSION_REJECTED', message: '' } }
    expect(resolveTaskErrorSummary(payload, 'fallback').message).toBe('fallback')
    expect(resolveTaskErrorSummary(
      payload,
      'fallback',
      (code) => code === 'PROVIDER_SUBMISSION_REJECTED'
        ? 'The provider rejected this request'
        : code,
    ).message).toBe('The provider rejected this request')
  })
})
