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
      shots: [
        {
          shotNumber: 1,
          shotLabel: 'Entrance',
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
        },
        {
          shotNumber: 2,
          shotLabel: 'Approach',
          absoluteLocation: 'center of the hall',
          anchorObject: 'first pillar',
          relationToAnchor: 'half step in front',
          distanceScale: 'closer distance',
          bodyFacing: 'walking forward',
          screenPosition: 'center third',
          foregroundLayer: 'floor',
          midgroundLayer: 'character and pillar',
          backgroundLayer: 'windows',
          cameraView: 'medium shot',
          negativeConstraints: [
            'do not hide behind pillar',
            'do not place at wall',
            'do not crop head',
          ],
        },
        {
          shotNumber: 3,
          shotLabel: 'Window',
          absoluteLocation: 'left side of the hall',
          anchorObject: 'window light',
          relationToAnchor: 'one step right of light',
          distanceScale: 'medium close',
          bodyFacing: 'toward window',
          screenPosition: 'left third',
          foregroundLayer: 'shadow',
          midgroundLayer: 'character',
          backgroundLayer: 'wall',
          cameraView: 'medium shot',
          negativeConstraints: [
            'do not leave light',
            'do not crop torso',
            'do not remove window',
          ],
        },
        {
          shotNumber: 4,
          shotLabel: 'Hold',
          absoluteLocation: 'middle of the hall',
          anchorObject: 'pillar row',
          relationToAnchor: 'between pillars',
          distanceScale: 'portrait distance',
          bodyFacing: 'toward camera',
          screenPosition: 'center frame',
          foregroundLayer: 'pillar edge',
          midgroundLayer: 'character',
          backgroundLayer: 'pillar row',
          cameraView: 'medium close shot',
          negativeConstraints: [
            'do not hide face',
            'do not move to rear wall',
            'do not top-down view',
          ],
        },
        {
          shotNumber: 5,
          shotLabel: 'Exit',
          absoluteLocation: 'near the second pillar',
          anchorObject: 'second pillar',
          relationToAnchor: 'one step in front',
          distanceScale: 'wide distance',
          bodyFacing: 'away from camera',
          screenPosition: 'right third',
          foregroundLayer: 'floor lines',
          midgroundLayer: 'character',
          backgroundLayer: 'deep hall',
          cameraView: 'wide shot',
          negativeConstraints: [
            'do not crop feet',
            'do not place at entrance',
            'do not remove pillar',
          ],
        },
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
      sceneImageUrl: '/api/files/scene.jpg',
      sceneStorageKey: 'scene.jpg',
      characterImageUrl: '/api/files/character.jpg',
      characterStorageKey: 'character.jpg',
      finalImages: [
        {
          shotNumber: 1,
          shotLabel: 'Entrance',
          prompt: 'final prompt 1',
          imageUrl: '/api/files/final-1.jpg',
          storageKey: 'final-1.jpg',
        },
        {
          shotNumber: 2,
          shotLabel: 'Approach',
          prompt: 'final prompt 2',
          imageUrl: '/api/files/final-2.jpg',
          storageKey: 'final-2.jpg',
        },
      ],
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
    })
    expect(payload.placementPlan.shots[0]).toMatchObject({
      absoluteLocation: 'center-right of the hall',
      anchorObject: 'concrete pillar',
    })
    expect(payload.finalImages).toHaveLength(2)
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
