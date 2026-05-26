import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const serviceMock = vi.hoisted(() => ({
  runTextPlacementTest: vi.fn(async (input: {
    readonly onProgress?: (event: unknown) => void | Promise<void>
  }) => {
    const placementPlan = {
      sceneBrief: 'A concrete hall.',
      characterABrief: 'Character A in a black coat.',
      characterBBrief: 'Character B in a red jacket.',
      shots: Array.from({ length: 5 }, (_, index) => ({
        shotNumber: index + 1,
        shotLabel: index === 0 ? 'Entrance' : `Beat ${index + 1}`,
        characterAPlacement: {
          absoluteLocation: index === 0 ? 'center-right of the hall' : `A zone ${index + 1}`,
          anchorObject: index === 0 ? 'concrete pillar' : `A anchor ${index + 1}`,
          relationToAnchor: 'one step left of the anchor',
          distanceScale: 'medium distance',
          bodyFacing: 'toward character B',
          screenPosition: 'right third',
        },
        characterBPlacement: {
          absoluteLocation: index === 0 ? 'left side of the hall' : `B zone ${index + 1}`,
          anchorObject: index === 0 ? 'window light' : `B anchor ${index + 1}`,
          relationToAnchor: 'one step right of the anchor',
          distanceScale: 'farther than character A',
          bodyFacing: 'toward character A',
          screenPosition: 'left third',
        },
        relationshipBetweenCharacters: 'character A and character B face each other across the pillar',
        foregroundLayer: 'dusty floor',
        midgroundLayer: 'both characters and pillar',
        backgroundLayer: 'rear wall',
        cameraView: 'eye-level medium shot',
        negativeConstraints: [
          'do not merge character A and character B',
          'do not swap character identities',
          'do not show only one character',
        ],
      })),
    }
    const result = {
      success: true,
      llmModelKey: 'llm-model-1',
      imageModelKey: 'image-model-1',
      placementPlan,
      placementPrompt: 'placement prompt',
      placementRawText: JSON.stringify(placementPlan),
      scenePrompt: 'scene prompt',
      characterAPrompt: 'character A prompt',
      characterBPrompt: 'character B prompt',
      sceneImageUrl: '/api/files/scene.jpg',
      sceneStorageKey: 'scene.jpg',
      characterAImageUrl: '/api/files/character-a.jpg',
      characterAStorageKey: 'character-a.jpg',
      characterBImageUrl: '/api/files/character-b.jpg',
      characterBStorageKey: 'character-b.jpg',
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
          shotLabel: 'Beat 2',
          prompt: 'final prompt 2',
          imageUrl: '/api/files/final-2.jpg',
          storageKey: 'final-2.jpg',
        },
      ],
    }
    await input.onProgress?.({
      type: 'placementPlan',
      placementPlan,
      placementPrompt: 'placement prompt',
      placementRawText: JSON.stringify(placementPlan),
    })
    await input.onProgress?.({
      type: 'complete',
      result,
    })
    return result
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

function parseStreamEvents(streamText: string): readonly unknown[] {
  return streamText
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      return JSON.parse(data) as unknown
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validBody() {
  return {
    storyPrompt: 'Two people meet in a concrete hall.',
    llmModelKey: 'llm-model-1',
    imageModelKey: 'image-model-1',
  }
}

describe('text placement test route', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/user/text-placement-test/run -> validates input and runs two-character text placement generation', async () => {
    const request = buildMockRequest({
      path: '/api/user/text-placement-test/run',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: validBody(),
    })

    const response = await POST(request, { params: Promise.resolve({}) })
    const events = parseStreamEvents(await response.text())
    const completeEvent = events.find((event) => isRecord(event) && event.type === 'complete')
    const payload = isRecord(completeEvent) ? completeEvent.result : null

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'placementPlan' }),
      expect.objectContaining({ type: 'complete' }),
    ]))
    expect(isRecord(payload)).toBe(true)
    if (!isRecord(payload)) throw new Error('expected complete payload')
    expect(payload).toMatchObject({
      success: true,
      sceneImageUrl: '/api/files/scene.jpg',
      characterAImageUrl: '/api/files/character-a.jpg',
      characterBImageUrl: '/api/files/character-b.jpg',
    })
    const placementPlan = payload.placementPlan
    if (!isRecord(placementPlan) || !Array.isArray(placementPlan.shots)) throw new Error('expected placement plan shots')
    expect(placementPlan.shots[0]).toMatchObject({
      characterAPlacement: expect.objectContaining({
        absoluteLocation: 'center-right of the hall',
        anchorObject: 'concrete pillar',
      }),
      characterBPlacement: expect.objectContaining({
        absoluteLocation: 'left side of the hall',
        anchorObject: 'window light',
      }),
      relationshipBetweenCharacters: 'character A and character B face each other across the pillar',
    })
    expect(Array.isArray(payload.finalImages) ? payload.finalImages : []).toHaveLength(2)
    expect(serviceMock.runTextPlacementTest).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      request: validBody(),
      onProgress: expect.any(Function),
    }))
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
