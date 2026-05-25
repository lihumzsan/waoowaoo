import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../../helpers/request'

const authState = vi.hoisted(() => ({
  authenticated: true,
}))

const serviceMock = vi.hoisted(() => ({
  generateCoordinateReferenceViews: vi.fn(async () => ({
    success: true,
    modelKey: 'image-model-1',
    floorPlanImageUrl: '/api/files/floor-plan.jpg',
    floorPlanImageDataUrl: 'data:image/jpeg;base64,FLOOR',
    floorPlanStorageKey: 'floor-plan.jpg',
    threeViewImageUrl: '/api/files/three-view.jpg',
    threeViewImageDataUrl: 'data:image/jpeg;base64,THREE',
    threeViewStorageKey: 'three-view.jpg',
    floorPlanPrompt: 'floor prompt',
    threeViewPrompt: 'three view prompt',
  })),
  analyzeCoordinatePlacement: vi.fn(async () => ({
    success: true,
    modelKey: 'llm-model-1',
    finalPrompt: 'analysis prompt',
    rawText: '{"person":{"x":7,"y":4},"camera":{"x":3,"y":8},"cameraFacing":"north","shotIntent":"Door view"}',
    analysis: {
      person: { x: 7, y: 4 },
      camera: { x: 3, y: 8 },
      cameraFacing: 'north',
      shotIntent: 'Door view',
    },
  })),
  runCoordinatePlacementTest: vi.fn(async () => ({
    success: true,
    imageUrl: '/api/files/coordinate-placement-test.jpg',
    storageKey: 'coordinate-placement-test.jpg',
    modelKey: 'image-model-1',
    promptVariant: 'strict_not_map',
    finalPrompt: 'final camera prompt',
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

import { POST as ANALYZE_POST } from '@/app/api/user/coordinate-placement-test/analyze/route'
import { POST as GENERATE_POST } from '@/app/api/user/coordinate-placement-test/generate/route'
import { POST as REFERENCE_VIEWS_POST } from '@/app/api/user/coordinate-placement-test/reference-views/route'

function validAnalyzeBody() {
  return {
    coordinateReferenceImage: 'data:image/png;base64,AAAA',
    userPrompt: 'Put the person on the marked floor tile.',
    referenceMode: 'outer_axes',
    llmModelKey: 'llm-model-1',
    grid: { columns: 16, rows: 9 },
  }
}

function validGenerateBody() {
  return {
    cameraReferenceImage: 'data:image/png;base64,AAAA',
    threeViewReferenceImage: 'data:image/png;base64,CCCC',
    characterImage: 'data:image/png;base64,BBBB',
    userPrompt: 'Put the person on the marked floor tile.',
    imageModelKey: 'image-model-1',
    promptVariant: 'strict_not_map',
    grid: { columns: 16, rows: 9 },
    analysis: {
      person: { x: 7, y: 4 },
      camera: { x: 3, y: 8 },
      cameraFacing: 'north',
      shotIntent: 'Door view',
    },
  }
}

describe('coordinate placement test route', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/user/coordinate-placement-test/reference-views -> generates floor plan and three-view references', async () => {
    const body = {
      sceneImage: 'data:image/png;base64,SCENE',
      userPrompt: 'Build references.',
      imageModelKey: 'image-model-1',
    }
    const request = buildMockRequest({
      path: '/api/user/coordinate-placement-test/reference-views',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body,
    })

    const response = await REFERENCE_VIEWS_POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      floorPlanImageDataUrl: 'data:image/jpeg;base64,FLOOR',
      threeViewImageDataUrl: 'data:image/jpeg;base64,THREE',
    })
    expect(serviceMock.generateCoordinateReferenceViews).toHaveBeenCalledWith({
      userId: 'user-1',
      locale: 'zh',
      request: body,
    })
  })

  it('POST /api/user/coordinate-placement-test/analyze -> validates input and runs coordinate analysis', async () => {
    const request = buildMockRequest({
      path: '/api/user/coordinate-placement-test/analyze',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: validAnalyzeBody(),
    })

    const response = await ANALYZE_POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.analysis).toEqual({
      person: { x: 7, y: 4 },
      camera: { x: 3, y: 8 },
      cameraFacing: 'north',
      shotIntent: 'Door view',
    })
    expect(serviceMock.analyzeCoordinatePlacement).toHaveBeenCalledWith({
      userId: 'user-1',
      locale: 'zh',
      request: validAnalyzeBody(),
    })
  })

  it('POST /api/user/coordinate-placement-test/generate -> validates input and runs camera-guided image generation', async () => {
    const request = buildMockRequest({
      path: '/api/user/coordinate-placement-test/generate',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: validGenerateBody(),
    })

    const response = await GENERATE_POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      success: true,
      imageUrl: '/api/files/coordinate-placement-test.jpg',
      storageKey: 'coordinate-placement-test.jpg',
      modelKey: 'image-model-1',
      promptVariant: 'strict_not_map',
      finalPrompt: 'final camera prompt',
    })
    expect(serviceMock.runCoordinatePlacementTest).toHaveBeenCalledWith({
      userId: 'user-1',
      locale: 'zh',
      request: validGenerateBody(),
    })
  })

  it('POST /api/user/coordinate-placement-test/generate -> rejects out-of-grid camera before model execution', async () => {
    const request = buildMockRequest({
      path: '/api/user/coordinate-placement-test/generate',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: {
        ...validGenerateBody(),
        grid: { columns: 12, rows: 8 },
        analysis: {
          ...validGenerateBody().analysis,
          camera: { x: 13, y: 4 },
        },
      },
    })

    const response = await GENERATE_POST(request, { params: Promise.resolve({}) })
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(JSON.stringify(payload)).toContain('COORDINATE_PLACEMENT_TEST_INPUT_INVALID')
    expect(serviceMock.runCoordinatePlacementTest).not.toHaveBeenCalled()
  })

  it('POST /api/user/coordinate-placement-test/analyze -> returns 401 when unauthenticated', async () => {
    authState.authenticated = false
    const request = buildMockRequest({
      path: '/api/user/coordinate-placement-test/analyze',
      method: 'POST',
      headers: { 'accept-language': 'zh' },
      body: validAnalyzeBody(),
    })

    const response = await ANALYZE_POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    expect(serviceMock.analyzeCoordinatePlacement).not.toHaveBeenCalled()
  })
})
