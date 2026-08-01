import { describe, expect, it } from 'vitest'
import { normalizeAnyError } from '@/lib/errors/normalize'

describe('normalizeAnyError network termination mapping', () => {
  it('maps undici terminated TypeError to NETWORK_ERROR', () => {
    const normalized = normalizeAnyError(new TypeError('terminated'))
    expect(normalized.code).toBe('NETWORK_ERROR')
    expect(normalized.retryable).toBe(true)
  })

  it('maps socket hang up TypeError to NETWORK_ERROR', () => {
    const normalized = normalizeAnyError(new TypeError('socket hang up'))
    expect(normalized.code).toBe('NETWORK_ERROR')
    expect(normalized.retryable).toBe(true)
  })

})

describe('normalizeAnyError database retry mapping', () => {
  it('treats a Prisma write conflict or deadlock as retryable infrastructure failure', () => {
    const normalized = normalizeAnyError({
      code: 'P2034',
      message: 'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
    })

    expect(normalized.code).toBe('EXTERNAL_ERROR')
    expect(normalized.retryable).toBe(true)
    expect(normalized.details).toMatchObject({ prismaCode: 'P2034' })
  })
})

describe('normalizeAnyError provider-specific mapping', () => {
  it('maps Ark ModelNotOpen payload to MODEL_NOT_OPEN', () => {
    const normalized = normalizeAnyError({
      status: 404,
      code: 'ModelNotOpen',
      message: 'Your account has not activated the model doubao-seedream. Please activate the model service in the Ark Console.',
    })
    expect(normalized.code).toBe('MODEL_NOT_OPEN')
    expect(normalized.retryable).toBe(false)
  })

  it('maps numeric provider code 500 to retryable EXTERNAL_ERROR', () => {
    const normalized = normalizeAnyError({
      code: 500,
      message: 'Internal Server Error',
      provider: 'openrouter',
    })
    expect(normalized.code).toBe('EXTERNAL_ERROR')
    expect(normalized.retryable).toBe(true)
    expect(normalized.provider).toBe('openrouter')
  })

  it('maps AI SDK statusCode 429 to retryable RATE_LIMIT', () => {
    const error = Object.assign(new Error('Ark rate limit exceeded'), { statusCode: 429 })

    const normalized = normalizeAnyError(error)

    expect(normalized.code).toBe('RATE_LIMIT')
    expect(normalized.retryable).toBe(true)
  })

})
