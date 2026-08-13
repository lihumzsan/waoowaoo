import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  issueWaoRuntimeToken,
  verifyWaoRuntimeToken,
} from '@/lib/wao-mcp/runtime-token'

const scope = {
  userId: 'user-runtime-token-test',
  projectId: 'project-runtime-token-test',
  assistantId: 'workspace-command',
} as const

describe('Wao Runtime signed placement identity', () => {
  const originalSecret = process.env.NEXTAUTH_SECRET

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'runtime-token-test-secret-32-bytes'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET
    else process.env.NEXTAUTH_SECRET = originalSecret
  })

  it('keeps an unchanged signed placement identity valid independent of wall-clock age', () => {
    const issued = issueWaoRuntimeToken({ scope })

    vi.setSystemTime(new Date('2036-08-12T00:00:00.000Z'))

    expect(verifyWaoRuntimeToken(issued.token)).toMatchObject({
      ...scope,
      nonce: issued.payload.nonce,
    })
  })

  it('rejects a placement identity whose signed payload was changed', () => {
    const issued = issueWaoRuntimeToken({ scope })
    const [prefix, encodedPayload, signature] = issued.token.split('.')
    if (!prefix || !encodedPayload || !signature) throw new Error('invalid test token')
    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>
    const changedPayload = Buffer.from(JSON.stringify({
      ...decoded,
      projectId: 'different-project',
    }), 'utf8').toString('base64url')

    expect(() => verifyWaoRuntimeToken(`${prefix}.${changedPayload}.${signature}`)).toThrowError(
      'WAO_RUNTIME_TOKEN_SIGNATURE_INVALID',
    )
  })
})
