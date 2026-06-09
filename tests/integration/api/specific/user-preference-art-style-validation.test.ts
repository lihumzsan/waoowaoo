import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireUserAuth: vi.fn(async () => ({
    session: { user: { id: 'user-1' } },
  })),
  isErrorResponse: vi.fn((value: unknown) => value instanceof Response),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    upsert: vi.fn(async () => ({
      userId: 'user-1',
      artStyle: 'realistic',
    })),
  },
}))

vi.mock('@/lib/api-auth', () => authMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

describe('api specific - user preference art style validation', () => {
  const routeContext = { params: Promise.resolve({}) }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects legacy artStyle without persisting', async () => {
    const mod = await import('@/app/api/user-preference/route')
    const req = buildMockRequest({
      path: '/api/user-preference',
      method: 'PATCH',
      body: { artStyle: '  realistic  ' },
    })

    const res = await mod.PATCH(req, routeContext)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('INVALID_PARAMS')
    expect(prismaMock.userPreference.upsert).not.toHaveBeenCalled()
  })

  it('accepts allowed preference fields and persists normalized value', async () => {
    const mod = await import('@/app/api/user-preference/route')
    const req = buildMockRequest({
      path: '/api/user-preference',
      method: 'PATCH',
      body: { videoRatio: '16:9' },
    })

    const res = await mod.PATCH(req, routeContext)
    expect(res.status).toBe(200)
    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ videoRatio: '16:9' }),
      }),
    )
  })
})
