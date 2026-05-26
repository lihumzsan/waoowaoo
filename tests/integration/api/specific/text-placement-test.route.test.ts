import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const serviceMock = vi.hoisted(() => ({
  runTextPlacementTest: vi.fn(async () => {
    const placementPlan = {
      sceneBrief: 'A concrete hall.',
      characterBrief: 'A man in a black coat.',
      absoluteLocation: 'center-right of the hall',
      anchorObject: 'concrete pillar',
      relationToAnchor: 'one step left of the pillar',
      distanceScale: 'medium distance',
      bodyFacing: 'toward camera',
      screenPosition: 'lower center-right third',
      foregroundLayer: 'dusty floor',
      midgroundLayer: 'character beside pillar',
      backgroundLayer: 'rear wall',
      cameraView: 'eye-level medium shot',
      negativeConstraints: [
        'do not place behind the pillar',
        'do not place outside the hall',
        'do not crop feet',
      ],
    }
    return {
      success: true,
      llmModelKey: 'llm-model-1',
      imageModelKey: 'image-model-1',
      placementPlan,
      placementPrompt: 'placement prompt',
      placementRawText: JSON.stringify(placementPlan),
      scenePrompt: 'scene prompt',
      characterPrompt: 'character prompt',
      finalPrompt: 'final prompt',
      sceneImageUrl: '/api/files/scene.jpg',
      sceneStorageKey: 'scene.jpg',
      characterImageUrl: '/api/files/character.jpg',
      characterStorageKey: 'character.jpg',
      finalImageUrl: '/api/files/final.jpg',
      finalStorageKey: 'final.jpg',
    }
  }),
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

vi.mock('@/lib/text-placement-test/service', () => serviceMock)

import { POST } from '@/app/api/user/text-placement-test/run/route'

function validBody() {
  return {
    storyPrompt: 'A man enters a concrete hall.',
    llmModelKey: 'llm-model-1',
    imageModelKey: 'image-model-1',
  }
}

describe('text placement test route', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/user/text-placement-test/run -> validates input and runs text placement generation', async () => {
    const request = buildMockRequest({
      path: '/api/user/text-placement-test/run',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: validBody(),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      sceneImageUrl: '/api/files/scene.jpg',
      characterImageUrl: '/api/files/character.jpg',
      finalImageUrl: '/api/files/final.jpg',
      placementPlan: {
        absoluteLocation: 'center-right of the hall',
        anchorObject: 'concrete pillar',
      },
    })
    expect(serviceMock.runTextPlacementTest).toHaveBeenCalledWith({
      userId: 'user-1',
      locale: 'zh',
      request: validBody(),
    })
  })

  it('POST /api/user/text-placement-test/run -> rejects invalid body before execution', async () => {
    const request = buildMockRequest({
      path: '/api/user/text-placement-test/run',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        storyPrompt: '',
        llmModelKey: 'llm-model-1',
        imageModelKey: 'image-model-1',
      },
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(JSON.stringify(payload)).toContain('TEXT_PLACEMENT_TEST_INPUT_INVALID')
    expect(serviceMock.runTextPlacementTest).not.toHaveBeenCalled()
  })

  it('POST /api/user/text-placement-test/run -> returns 401 when unauthenticated', async () => {
    authState.authenticated = false
    const request = buildMockRequest({
      path: '/api/user/text-placement-test/run',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: validBody(),
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    expect(serviceMock.runTextPlacementTest).not.toHaveBeenCalled()
  })
})
