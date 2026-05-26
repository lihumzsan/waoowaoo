import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextPlacementPlan, TextPlacementTestRunRequest } from '@/lib/text-placement-test/types'

const placementPlan = vi.hoisted((): TextPlacementPlan => ({
  sceneBrief: 'A concrete hall with tall windows and a row of pillars.',
  characterABrief: 'Character A is a man wearing a long black coat and dark glasses.',
  characterBBrief: 'Character B is a woman wearing a red jacket and short hair.',
  shots: Array.from({ length: 5 }, (_, index) => ({
    shotNumber: index + 1,
    shotLabel: index === 0 ? 'Separated by pillar' : `Relationship beat ${index + 1}`,
    characterAPlacement: {
      absoluteLocation: index === 0
        ? 'center-right of the hall, two steps in front of the rear wall'
        : `hall zone A ${index + 1}`,
      anchorObject: index === 0 ? 'the nearest concrete pillar' : `pillar A ${index + 1}`,
      relationToAnchor: index === 0
        ? 'one body width to the left of the pillar, not hidden by it'
        : `one step from pillar A ${index + 1}`,
      distanceScale: 'medium distance from camera, full body visible',
      bodyFacing: 'body angled toward character B',
      screenPosition: 'lower center-right third',
    },
    characterBPlacement: {
      absoluteLocation: index === 0
        ? 'left side of the hall near the window light'
        : `hall zone B ${index + 1}`,
      anchorObject: index === 0 ? 'bright window rectangle' : `window B ${index + 1}`,
      relationToAnchor: index === 0
        ? 'one step to the right of the window light, facing character A'
        : `one step from window B ${index + 1}`,
      distanceScale: 'slightly farther from camera than character A',
      bodyFacing: 'body turned toward character A',
      screenPosition: 'left third',
    },
    relationshipBetweenCharacters: index === 0
      ? 'character A and character B face each other across the nearest concrete pillar'
      : `relationship beat ${index + 1}`,
    foregroundLayer: 'empty dusty floor',
    midgroundLayer: 'both characters separated by the concrete pillar',
    backgroundLayer: 'rear wall and tall windows',
    cameraView: 'eye-level medium full shot from the hall entrance',
    negativeConstraints: [
      'do not merge character A and character B',
      'do not swap character A and character B identities',
      'do not show only one character',
    ],
  })),
}))

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
        content: JSON.stringify(placementPlan),
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
    'https://normalized.example/character-a.png',
    'https://normalized.example/character-b.png',
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
    storyPrompt: 'Two people meet in a concrete hall.',
    llmModelKey: 'llm-model-1',
    imageModelKey: 'image-model-1',
  }
}

describe('text placement test service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates scene, two character assets, and sequential final images from text placement planning', async () => {
    const { runTextPlacementTest } = await import('@/lib/text-placement-test/service')

    const result = await runTextPlacementTest({
      userId: 'user-1',
      locale: 'en',
      request: buildRequest(),
    })

    expect(result.placementPlan).toEqual(placementPlan)
    expect(result.sceneStorageKey).toBe('text-placement-test-scene/stored.jpg')
    expect(result.characterAStorageKey).toBe('text-placement-test-character-a/stored.jpg')
    expect(result.characterBStorageKey).toBe('text-placement-test-character-b/stored.jpg')
    expect(result.finalImages).toHaveLength(5)
    expect(result.finalImages[0]).toMatchObject({
      shotNumber: 1,
      shotLabel: 'Separated by pillar',
      storageKey: 'text-placement-test-final-shot-1/stored.jpg',
    })
    expect(engineMock.chatCompletion).toHaveBeenCalledWith(
      'user-1',
      'llm-model-1',
      [{ role: 'user', content: expect.stringContaining('two-character text-based absolute placement shots') }],
      { temperature: 0.2 },
    )
    expect(engineMock.generateImage).toHaveBeenCalledTimes(8)
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
      expect.stringContaining('Character A brief: Character A is a man wearing a long black coat'),
      expect.objectContaining({ resolution: '1K', aspectRatio: '3:4' }),
    )
    expect(engineMock.generateImage).toHaveBeenNthCalledWith(
      3,
      'user-1',
      'image-model-1',
      expect.stringContaining('Character B brief: Character B is a woman wearing a red jacket'),
      expect.objectContaining({ resolution: '1K', aspectRatio: '3:4' }),
    )
    expect(outboundImageMock.normalizeReferenceImagesForGeneration).toHaveBeenCalledWith(
      [
        'https://signed.example/text-placement-test-scene/stored.jpg',
        'https://signed.example/text-placement-test-character-a/stored.jpg',
        'https://signed.example/text-placement-test-character-b/stored.jpg',
      ],
      expect.objectContaining({
        context: { scope: 'text-placement-test.final' },
      }),
    )
    expect(engineMock.generateImage).toHaveBeenNthCalledWith(
      4,
      'user-1',
      'image-model-1',
      expect.stringContaining('Current shot: shot 1, Separated by pillar'),
      expect.objectContaining({
        referenceImages: [
          'https://normalized.example/scene.png',
          'https://normalized.example/character-a.png',
          'https://normalized.example/character-b.png',
        ],
        resolution: '1K',
        aspectRatio: '16:9',
      }),
    )
    expect(engineMock.generateImage).toHaveBeenNthCalledWith(
      8,
      'user-1',
      'image-model-1',
      expect.stringContaining('Current shot: shot 5, Relationship beat 5'),
      expect.objectContaining({
        referenceImages: [
          'https://normalized.example/scene.png',
          'https://normalized.example/character-a.png',
          'https://normalized.example/character-b.png',
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
