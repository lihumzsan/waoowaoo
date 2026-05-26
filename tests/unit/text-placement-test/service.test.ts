import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextPlacementTestRunRequest } from '@/lib/text-placement-test/types'

const placementPlan = {
  sceneBrief: 'A concrete hall with tall windows and a row of pillars.',
  characterBrief: 'A man wearing a long black coat.',
  absoluteLocation: 'center-right of the hall, two steps in front of the rear wall',
  anchorObject: 'the nearest concrete pillar',
  relationToAnchor: 'one body width to the left of the pillar, not hidden by it',
  distanceScale: 'medium distance from camera, full body visible',
  bodyFacing: 'body angled toward camera, face looking toward the window light',
  screenPosition: 'lower center-right third, occupying half of frame height',
  foregroundLayer: 'empty dusty floor',
  midgroundLayer: 'the character beside the concrete pillar',
  backgroundLayer: 'rear wall and tall windows',
  cameraView: 'eye-level medium full shot from the hall entrance',
  negativeConstraints: [
    'do not place the character behind the pillar',
    'do not place the character outside the hall',
    'do not crop off the feet',
  ],
}

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    editModel: 'unused-default-image-model',
    capabilityDefaults: {},
  })),
  resolveModelCapabilityGenerationOptions: vi.fn(() => ({
    resolution: '1K',
  })),
}))

const engineMock = vi.hoisted(() => ({
  chatCompletion: vi.fn(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          sceneBrief: 'A concrete hall with tall windows and a row of pillars.',
          characterBrief: 'A man wearing a long black coat.',
          absoluteLocation: 'center-right of the hall, two steps in front of the rear wall',
          anchorObject: 'the nearest concrete pillar',
          relationToAnchor: 'one body width to the left of the pillar, not hidden by it',
          distanceScale: 'medium distance from camera, full body visible',
          bodyFacing: 'body angled toward camera, face looking toward the window light',
          screenPosition: 'lower center-right third, occupying half of frame height',
          foregroundLayer: 'empty dusty floor',
          midgroundLayer: 'the character beside the concrete pillar',
          backgroundLayer: 'rear wall and tall windows',
          cameraView: 'eye-level medium full shot from the hall entrance',
          negativeConstraints: [
            'do not place the character behind the pillar',
            'do not place the character outside the hall',
            'do not crop off the feet',
          ],
        }),
      },
    }],
  })),
  generateImage: vi.fn(async () => ({
    success: true,
    imageUrl: 'https://generated.example/image.png',
    async: false,
  })),
}))

const outboundImageMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async () => [
    'https://normalized.example/scene.png',
    'https://normalized.example/character.png',
  ]),
}))

const mediaProcessMock = vi.hoisted(() => ({
  processMediaResult: vi.fn(async (input: { readonly keyPrefix: string }) => `${input.keyPrefix}/stored.jpg`),
}))

const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

const runtimeConfigMock = vi.hoisted(() => ({
  getModelsByType: vi.fn(async (_userId: string, type: 'llm' | 'image') => (
    type === 'llm'
      ? [{ modelKey: 'llm-model-1' }]
      : [{ modelKey: 'image-model-1' }]
  )),
}))

vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/ai-exec/engine', () => engineMock)
vi.mock('@/lib/media/outbound-image', () => outboundImageMock)
vi.mock('@/lib/media-process', () => mediaProcessMock)
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/user-api/runtime-config', () => runtimeConfigMock)

function buildRequest(): TextPlacementTestRunRequest {
  return {
    storyPrompt: 'A man enters a concrete hall.',
    llmModelKey: 'llm-model-1',
    imageModelKey: 'image-model-1',
  }
}

describe('text placement test service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates scene, character, and final image from text placement planning', async () => {
    const { runTextPlacementTest } = await import('@/lib/text-placement-test/service')

    const result = await runTextPlacementTest({
      userId: 'user-1',
      locale: 'en',
      request: buildRequest(),
    })

    expect(result.placementPlan).toEqual(placementPlan)
    expect(result.sceneStorageKey).toBe('text-placement-test-scene/stored.jpg')
    expect(result.characterStorageKey).toBe('text-placement-test-character/stored.jpg')
    expect(result.finalStorageKey).toBe('text-placement-test-final/stored.jpg')
    expect(engineMock.chatCompletion).toHaveBeenCalledWith(
      'user-1',
      'llm-model-1',
      [{ role: 'user', content: expect.stringContaining('text-based absolute placement plan') }],
      { temperature: 0.2 },
    )
    expect(engineMock.generateImage).toHaveBeenCalledTimes(3)
    expect(engineMock.generateImage).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'image-model-1',
      expect.stringContaining('Generate one clean scene asset image'),
      expect.objectContaining({ resolution: '1K', aspectRatio: '16:9' }),
    )
    expect(engineMock.generateImage).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'image-model-1',
      expect.stringContaining('Generate one single-character asset image'),
      expect.objectContaining({ resolution: '1K', aspectRatio: '3:4' }),
    )
    expect(outboundImageMock.normalizeReferenceImagesForGeneration).toHaveBeenCalledWith(
      [
        'https://signed.example/text-placement-test-scene/stored.jpg',
        'https://signed.example/text-placement-test-character/stored.jpg',
      ],
      expect.objectContaining({
        context: { scope: 'text-placement-test.final' },
      }),
    )
    expect(engineMock.generateImage).toHaveBeenNthCalledWith(
      3,
      'user-1',
      'image-model-1',
      expect.stringContaining('Character absolute location: center-right of the hall'),
      expect.objectContaining({
        referenceImages: [
          'https://normalized.example/scene.png',
          'https://normalized.example/character.png',
        ],
        resolution: '1K',
        aspectRatio: '16:9',
      }),
    )
  })

  it('rejects a model that is not selectable by the user', async () => {
    runtimeConfigMock.getModelsByType.mockResolvedValueOnce([])
    const { runTextPlacementTest } = await import('@/lib/text-placement-test/service')

    await expect(runTextPlacementTest({
      userId: 'user-1',
      locale: 'en',
      request: buildRequest(),
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'TEXT_PLACEMENT_TEST_MODEL_INVALID',
        field: 'llmModelKey',
      }),
    })
  })
})
