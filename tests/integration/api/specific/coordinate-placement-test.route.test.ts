import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const serviceMock = vi.hoisted(() => ({
  runCoordinatePlacementTest: vi.fn(async () => ({
    success: true,
    imageUrl: '/api/files/coordinate-placement-test.jpg',
    storageKey: 'coordinate-placement-test.jpg',
    modelKey: 'openai::gpt-image-test',
    finalPrompt: 'final coordinate prompt',
  })),
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
  }
})

vi.mock('@/lib/coordinate-placement-test/service', () => serviceMock)

import { POST } from '@/app/api/user/coordinate-placement-test/generate/route'

function validBody() {
  return {
    coordinateReferenceImage: 'data:image/png;base64,AAAA',
    characterImage: 'data:image/png;base64,BBBB',
    userPrompt: 'Put the person on the marked floor tile.',
    referenceMode: 'outer_axes',
    grid: { columns: 16, rows: 9 },
    target: { x: 7, y: 4 },
  }
}

describe('coordinate placement test route', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/user/coordinate-placement-test/generate -> validates input and runs coordinate placement test', async () => {
    const request = buildMockRequest({
      path: '/api/user/coordinate-placement-test/generate',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: validBody(),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      imageUrl: '/api/files/coordinate-placement-test.jpg',
      storageKey: 'coordinate-placement-test.jpg',
      modelKey: 'openai::gpt-image-test',
      finalPrompt: 'final coordinate prompt',
    })
    expect(serviceMock.runCoordinatePlacementTest).toHaveBeenCalledWith({
      userId: 'user-1',
      locale: 'zh',
      request: validBody(),
    })
  })

  it('POST /api/user/coordinate-placement-test/generate -> rejects out-of-grid targets before model execution', async () => {
    const request = buildMockRequest({
      path: '/api/user/coordinate-placement-test/generate',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        ...validBody(),
        grid: { columns: 12, rows: 8 },
        target: { x: 13, y: 4 },
      },
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(JSON.stringify(payload)).toContain('COORDINATE_PLACEMENT_TEST_INPUT_INVALID')
    expect(serviceMock.runCoordinatePlacementTest).not.toHaveBeenCalled()
  })

  it('POST /api/user/coordinate-placement-test/generate -> returns 401 when unauthenticated', async () => {
    authState.authenticated = false
    const request = buildMockRequest({
      path: '/api/user/coordinate-placement-test/generate',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: validBody(),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    expect(serviceMock.runCoordinatePlacementTest).not.toHaveBeenCalled()
  })
})
