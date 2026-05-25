import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CoordinatePlacementAnalyzeRequest,
  CoordinatePlacementGenerateRequest,
} from '@/lib/coordinate-placement-test/types'

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    editModel: 'unused-default-image-model',
    capabilityDefaults: {},
  })),
  resolveModelCapabilityGenerationOptions: vi.fn(() => ({
    aspectRatio: '16:9',
    resolution: '1K',
  })),
}))

const engineMock = vi.hoisted(() => ({
  chatCompletionWithVision: vi.fn(async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          person: { x: 7, y: 4 },
          camera: { x: 3, y: 8 },
          cameraFacing: 'north',
          shotIntent: 'Shoot from the room interior toward the door.',
        }),
      },
    }],
  })),
  generateImage: vi.fn(async () => ({
    success: true,
    imageUrl: 'https://generated.example/result.png',
    async: false,
  })),
}))

const outboundImageMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(),
}))

const mediaProcessMock = vi.hoisted(() => ({
  processMediaResult: vi.fn(async () => 'coordinate-placement-test/result.jpg'),
}))

const storageMock = vi.hoisted(() => ({
  getObjectBuffer: vi.fn(async () => Buffer.from('stored-image')),
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

async function buildPngDataUrl(width: number, height: number): Promise<string> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#ffffff',
    },
  }).png().toBuffer()
  return `data:image/png;base64,${buffer.toString('base64')}`
}

function buildAnalyzeRequest(): CoordinatePlacementAnalyzeRequest {
  return {
    coordinateReferenceImage: 'data:image/png;base64,REFERENCE',
    userPrompt: '把人物放在门口附近，并从房间内侧拍摄。',
    referenceMode: 'overlay',
    llmModelKey: 'llm-model-1',
    grid: { columns: 16, rows: 9 },
  }
}

function buildGenerateRequest(): CoordinatePlacementGenerateRequest {
  return {
    cameraReferenceImage: 'data:image/png;base64,CAMERA',
    threeViewReferenceImage: 'data:image/png;base64,THREEVIEW',
    characterImage: 'data:image/png;base64,CHARACTER',
    userPrompt: '把人物放在目标位置。',
    imageModelKey: 'image-model-1',
    grid: { columns: 16, rows: 9 },
    analysis: {
      person: { x: 7, y: 4 },
      camera: { x: 3, y: 8 },
      cameraFacing: 'north',
      shotIntent: '从房间内侧看向门口。',
    },
  }
}

describe('coordinate placement test service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates 2D floor-plan and three-view references with the selected image model', async () => {
    const sourceReference = await buildPngDataUrl(96, 96)
    outboundImageMock.normalizeReferenceImagesForGeneration.mockResolvedValue([sourceReference])
    const { generateCoordinateReferenceViews } = await import('@/lib/coordinate-placement-test/service')

    const result = await generateCoordinateReferenceViews({
      userId: 'user-1',
      locale: 'zh',
      request: {
        sceneImage: 'data:image/png;base64,SCENE',
        userPrompt: '生成房间参考。',
        imageModelKey: 'image-model-1',
      },
    })

    expect(result.floorPlanImageDataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('stored-image').toString('base64')}`)
    expect(result.threeViewImageDataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('stored-image').toString('base64')}`)
    expect(engineMock.generateImage).toHaveBeenCalledTimes(2)
    expect(engineMock.generateImage).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'image-model-1',
      expect.stringContaining('2D 俯视平面图'),
      expect.objectContaining({
        referenceImages: [sourceReference],
        aspectRatio: '1:1',
      }),
    )
    expect(engineMock.generateImage).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'image-model-1',
      expect.stringContaining('三视图参考图'),
      expect.objectContaining({
        referenceImages: [sourceReference],
        aspectRatio: '16:9',
      }),
    )
  })

  it('uses the selected LLM to turn the coordinate reference image into structured camera placement', async () => {
    const coordinateReference = await buildPngDataUrl(96, 96)
    outboundImageMock.normalizeReferenceImagesForGeneration.mockResolvedValue([coordinateReference])
    const { analyzeCoordinatePlacement } = await import('@/lib/coordinate-placement-test/service')

    const result = await analyzeCoordinatePlacement({
      userId: 'user-1',
      locale: 'zh',
      request: buildAnalyzeRequest(),
    })

    expect(result.analysis).toEqual({
      person: { x: 7, y: 4 },
      camera: { x: 3, y: 8 },
      cameraFacing: 'north',
      shotIntent: 'Shoot from the room interior toward the door.',
    })
    expect(engineMock.chatCompletionWithVision).toHaveBeenCalledWith(
      'user-1',
      'llm-model-1',
      expect.stringContaining('摄影机镜头朝向'),
      [coordinateReference],
      { temperature: 0.1 },
    )
  })

  it('passes the selected image model and camera-reference aspectRatio to image generation', async () => {
    const cameraReference = await buildPngDataUrl(96, 96)
    const threeViewReference = await buildPngDataUrl(160, 90)
    const characterReference = await buildPngDataUrl(64, 96)
    outboundImageMock.normalizeReferenceImagesForGeneration.mockResolvedValue([
      cameraReference,
      threeViewReference,
      characterReference,
    ])
    const { runCoordinatePlacementTest } = await import('@/lib/coordinate-placement-test/service')

    const result = await runCoordinatePlacementTest({
      userId: 'user-1',
      locale: 'zh',
      request: buildGenerateRequest(),
    })

    expect(result.imageUrl).toBe('https://signed.example/coordinate-placement-test/result.jpg')
    expect(engineMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'image-model-1',
      expect.stringContaining('📷 图标表示摄影机位置'),
      expect.objectContaining({
        referenceImages: [cameraReference, threeViewReference, characterReference],
        resolution: '1K',
        aspectRatio: '1:1',
      }),
    )
  })
})
