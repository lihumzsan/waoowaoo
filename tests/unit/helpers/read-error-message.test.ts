import { describe, expect, it } from 'vitest'
import { readApiErrorMessage } from '@/lib/api/read-error-message'

function buildJsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('readApiErrorMessage', () => {
  it('returns nested api error message instead of [object Object]', async () => {
    const response = buildJsonResponse({
      error: {
        code: 'INVALID_PARAMS',
        message: 'Episode name is required',
      },
      message: 'Invalid parameters',
    })

    await expect(readApiErrorMessage(response, '创建失败')).resolves.toBe('Episode name is required')
  })

  it('falls back when the response body is not json', async () => {
    const response = new Response('bad gateway', { status: 502 })

    await expect(readApiErrorMessage(response, '创建失败')).resolves.toBe('创建失败')
  })
})
