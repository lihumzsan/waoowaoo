import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const serviceMock = vi.hoisted(() => ({
  retryTextPlacementAsset: vi.fn(async () => ({
    asset: 'scene',
    prompt: 'scene prompt',
    imageUrl: '/api/files/scene-retry.jpg',
    storageKey: 'scene-retry.jpg',
  })),
  retryTextPlacementFinalImage: vi.fn(async () => ({
    shotNumber: 1,
    shotLabel: 'Entrance',
    prompt: 'final prompt',
    imageUrl: '/api/files/final-retry.jpg',
    storageKey: 'final-retry.jpg',
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

vi.mock('@/lib/text-placement-test/service', () => serviceMock)

import { POST } from '@/app/api/user/text-placement-test/retry/route'

const shot = {
  shotNumber: 1,
  shotLabel: 'Entrance',
  characterAPlacement: {
    absoluteLocation: 'center-right of the hall',
    anchorObject: 'concrete pillar',
    relationToAnchor: 'one step left of the pillar',
    distanceScale: 'medium distance',
    bodyFacing: 'toward character B',
    screenPosition: 'right third',
  },
  characterBPlacement: {
    absoluteLocation: 'left side of the hall',
    anchorObject: 'window light',
    relationToAnchor: 'one step right of the light',
    distanceScale: 'farther than character A',
    bodyFacing: 'toward character A',
    screenPosition: 'left third',
  },
  relationshipBetweenCharacters: 'character A and character B face each other',
  foregroundLayer: 'dusty floor',
  midgroundLayer: 'both characters',
  backgroundLayer: 'rear wall',
  cameraView: 'eye-level medium shot',
  negativeConstraints: [
    'do not merge character A and character B',
    'do not swap identities',
    'do not show only one character',
  ],
}

describe('text placement retry route', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/user/text-placement-test/retry -> retries an asset step', async () => {
    const request = buildMockRequest({
      path: '/api/user/text-placement-test/retry',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        type: 'asset',
        imageModelKey: 'image-model-1',
        asset: 'scene',
        prompt: 'scene prompt',
      },
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      type: 'asset',
      asset: {
        asset: 'scene',
        prompt: 'scene prompt',
        imageUrl: '/api/files/scene-retry.jpg',
        storageKey: 'scene-retry.jpg',
      },
    })
    expect(serviceMock.retryTextPlacementAsset).toHaveBeenCalledWith({
      userId: 'user-1',
      request: {
        type: 'asset',
        imageModelKey: 'image-model-1',
        asset: 'scene',
        prompt: 'scene prompt',
      },
    })
  })

  it('POST /api/user/text-placement-test/retry -> retries one final image step', async () => {
    const request = buildMockRequest({
      path: '/api/user/text-placement-test/retry',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        type: 'finalImage',
        storyPrompt: 'Two people meet in a hall.',
        imageModelKey: 'image-model-1',
        shot,
        referenceImages: [
          '/api/files/scene.jpg',
          '/api/files/character-a.jpg',
          '/api/files/character-b.jpg',
        ],
      },
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      type: 'finalImage',
      image: {
        shotNumber: 1,
        shotLabel: 'Entrance',
        prompt: 'final prompt',
        imageUrl: '/api/files/final-retry.jpg',
        storageKey: 'final-retry.jpg',
      },
    })
    expect(serviceMock.retryTextPlacementFinalImage).toHaveBeenCalledWith({
      userId: 'user-1',
      locale: 'zh',
      request: {
        type: 'finalImage',
        storyPrompt: 'Two people meet in a hall.',
        imageModelKey: 'image-model-1',
        shot,
        referenceImages: [
          '/api/files/scene.jpg',
          '/api/files/character-a.jpg',
          '/api/files/character-b.jpg',
        ],
      },
    })
  })
})
