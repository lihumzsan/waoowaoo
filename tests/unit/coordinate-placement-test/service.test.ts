import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoordinatePlacementTestRequest } from '@/lib/coordinate-placement-test/types'

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    editModel: 'fal::gpt-image-2',
    capabilityDefaults: {},
  })),
  resolveModelCapabilityGenerationOptions: vi.fn(() => ({
    aspectRatio: '16:9',
    resolution: '1K',
  })),
}))

const engineMock = vi.hoisted(() => ({
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
  processMediaResult: vi.fn(async () => 'coordinate-placement-test/result.png'),
}))

const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/ai-exec/engine', () => engineMock)
vi.mock('@/lib/media/outbound-image', () => outboundImageMock)
vi.mock('@/lib/media-process', () => mediaProcessMock)
vi.mock('@/lib/storage', () => storageMock)

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

function buildRequest(): CoordinatePlacementTestRequest {
  return {
    coordinateReferenceImage: 'data:image/png;base64,REFERENCE',
    characterImage: 'data:image/png;base64,CHARACTER',
    userPrompt: '把人物放在目标格子里。',
    referenceMode: 'overlay',
    grid: { columns: 16, rows: 9 },
    target: { x: 7, y: 4 },
  }
}

describe('coordinate placement test service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the coordinate reference image aspectRatio to image generation instead of the capability default', async () => {
    const coordinateReference = await buildPngDataUrl(96, 96)
    const characterReference = await buildPngDataUrl(64, 96)
    outboundImageMock.normalizeReferenceImagesForGeneration.mockResolvedValue([
      coordinateReference,
      characterReference,
    ])
    const { runCoordinatePlacementTest } = await import('@/lib/coordinate-placement-test/service')

    const result = await runCoordinatePlacementTest({
      userId: 'user-1',
      locale: 'zh',
      request: buildRequest(),
    })

    expect(result.imageUrl).toBe('https://signed.example/coordinate-placement-test/result.png')
    expect(engineMock.generateImage).toHaveBeenCalledWith(
      'user-1',
      'fal::gpt-image-2',
      expect.stringContaining('把人物放在目标格子里。'),
      expect.objectContaining({
        referenceImages: [coordinateReference, characterReference],
        resolution: '1K',
        aspectRatio: '1:1',
      }),
    )
  })
})
