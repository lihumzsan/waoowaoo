import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCATION_IMAGE_RATIO, PROP_IMAGE_RATIO } from '@/lib/constants'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ locationModel: 'location-model-1', analysisModel: 'analysis-model-1' })),
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  locationImage: {
    findUnique: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => ({})),
  },
  projectLocation: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectEditScreenplay: {
    findFirst: vi.fn(),
  },
  projectEditAssetRequirement: {
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
}))

const sharedMock = vi.hoisted(() => ({
  generateCleanImageToStorage: vi.fn(async () => 'cos/location-generated-1.png'),
}))

const spatialProfileServiceMock = vi.hoisted(() => ({
  analyzeAndPersistProjectLocationImageSpatialProfile: vi.fn(async () => ({
    schemaVersion: 1,
    sceneSummary: '街道空间',
    anchors: [{
      id: 'anchor_wall',
      label: '左侧墙面',
      screenArea: '画面左侧',
      depthLayer: '中景',
      spatialRelations: ['墙面右侧是街道'],
    }],
    depthLayout: {
      foreground: '街道前景',
      midground: '墙边和路面',
      background: '远处街灯',
    },
    lightingDirection: '街灯从右后方照入',
  })),
}))

const textEngineMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({
    text: JSON.stringify({ prompt: '雨夜街道候选最终 prompt，完整空场景资产图' }),
  })),
}))

const visionSupportMock = vi.hoisted(() => ({
  assertVisionModelSupported: vi.fn(async () => undefined),
}))

vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-exec/engine', () => textEngineMock)
vi.mock('@/lib/ai-exec/vision-support', () => visionSupportMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    generateCleanImageToStorage: sharedMock.generateCleanImageToStorage,
  }
})
vi.mock('@/lib/location-spatial-profile/service', () => spatialProfileServiceMock)

import { handleLocationImageTask } from '@/lib/workers/handlers/location-image-task-handler'

function buildJob(
  payload: Record<string, unknown>,
  targetId = 'location-image-1',
  episodeId: string | null = null,
): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-location-image-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      locale: 'zh',
      projectId: 'project-1',
      episodeId,
      targetType: 'LocationImage',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker location-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
    })

    prismaMock.locationImage.findUnique.mockResolvedValue({
      id: 'location-image-1',
      locationId: 'location-1',
      imageIndex: 0,
      description: '雨夜街道',
      location: { name: 'Old Town' },
    })

    prismaMock.projectLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      name: 'Old Town',
      images: [
        {
          id: 'location-image-1',
          locationId: 'location-1',
          imageIndex: 0,
          description: '雨夜街道',
        },
      ],
    })
    prismaMock.projectEditScript.findFirst.mockResolvedValue(null)
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValue(null)
  })

  it('locationModel missing -> explicit error', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ locationModel: '', analysisModel: 'analysis-model-1' })
    await expect(handleLocationImageTask(buildJob({}))).rejects.toThrow('Location model not configured')
  })

  it('analysis model missing for location -> explicit spatial profile error', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ locationModel: 'location-model-1', analysisModel: '' })
    await expect(handleLocationImageTask(buildJob({ imageIndex: 0 }))).rejects.toThrow('LOCATION_SPATIAL_PROFILE_MODEL_REQUIRED')
  })

  it('unsupported location spatial profile model -> fails before generating image', async () => {
    visionSupportMock.assertVisionModelSupported.mockRejectedValueOnce(
      new Error('LOCATION_SPATIAL_PROFILE_MODEL_UNSUPPORTED:codex::gpt-5.5'),
    )

    await expect(handleLocationImageTask(buildJob({ imageIndex: 0 }))).rejects.toThrow(
      'LOCATION_SPATIAL_PROFILE_MODEL_UNSUPPORTED:codex::gpt-5.5',
    )

    expect(visionSupportMock.assertVisionModelSupported).toHaveBeenCalledWith({
      userId: 'user-1',
      model: 'analysis-model-1',
      errorCode: 'LOCATION_SPATIAL_PROFILE_MODEL_UNSUPPORTED',
    })
    expect(sharedMock.generateCleanImageToStorage).not.toHaveBeenCalled()
    expect(spatialProfileServiceMock.analyzeAndPersistProjectLocationImageSpatialProfile).not.toHaveBeenCalled()
  })

  it('success path -> generates and persists concrete location image url', async () => {
    const result = await handleLocationImageTask(buildJob({ imageIndex: 0 }))

    expect(result).toEqual({
      updated: 1,
      locationIds: ['location-1'],
    })

    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('雨夜街道候选最终 prompt'),
        targetId: 'location-image-1',
        options: expect.objectContaining({ aspectRatio: LOCATION_IMAGE_RATIO }),
      }),
    )
    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('为后续人物落位保留清晰稳定的空间锚点'),
      }),
    )
    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('必须使用宽广完整的场景全景构图'),
      }),
    )
    const generationCall = sharedMock.generateCleanImageToStorage.mock.calls[0] as unknown as [{ prompt: string }] | undefined
    expect(generationCall).toBeTruthy()
    if (!generationCall) throw new Error('expected generateCleanImageToStorage call')
    const generationInput = generationCall[0]
    expect(generationInput.prompt).not.toContain('可站位置：')
    expect(generationInput.prompt).not.toContain('美式漫画风格')
    expect(generationInput.prompt).not.toContain('日式动漫风格')
    expect(generationInput.prompt).not.toContain('写实电影风格')
    expect(textEngineMock.executeAiTextStep).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'analysis-model-1',
        action: 'location_candidate_prompt',
      }),
    )

    expect(prismaMock.locationImage.update).toHaveBeenCalledWith({
      where: { id: 'location-image-1' },
      data: {
        imageUrl: 'cos/location-generated-1.png',
        spatialProfileStatus: 'stale',
        spatialProfileError: null,
      },
    })
    expect(prismaMock.locationImage.updateMany).toHaveBeenCalledWith({
      where: { locationId: 'location-1' },
      data: { isSelected: false },
    })
    expect(prismaMock.locationImage.update).toHaveBeenCalledWith({
      where: { id: 'location-image-1' },
      data: { isSelected: true },
    })
    expect(prismaMock.projectLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { selectedImageId: 'location-image-1' },
    })
    expect(spatialProfileServiceMock.analyzeAndPersistProjectLocationImageSpatialProfile).toHaveBeenCalledWith({
      imageId: 'location-image-1',
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model-1',
      locale: 'zh',
    })
    expect(prismaMock.projectEditAssetRequirement.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        kind: 'location',
        targetId: { in: ['location-1'] },
      },
      data: {
        status: 'completed',
        errorMessage: null,
      },
    })
  })

  it('appends Style Bible block to final location asset image prompt', async () => {
    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      styleBibleJson: buildZenStyleBibleFixture(),
    })

    await handleLocationImageTask(buildJob({ imageIndex: 0 }, 'location-image-1', 'episode-1'))

    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('系统 Style Bible 视觉要求（固定追加，必须遵守）：'),
      }),
    )
    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('用途：资产图生成'),
      }),
    )
    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('色彩：低饱和，自然灰绿、木色、石灰色。'),
      }),
    )
  })

  it('legacy payload artStyle -> explicit error', async () => {
    await expect(handleLocationImageTask(buildJob({ imageIndex: 0, artStyle: 'anime' }))).rejects.toThrow(
      'LEGACY_ART_STYLE_REMOVED',
    )
  })

  it('honors requested count when location already has more slots', async () => {
    prismaMock.locationImage.findUnique.mockResolvedValueOnce(null)
    prismaMock.projectLocation.findUnique.mockResolvedValueOnce({
      id: 'location-1',
      name: 'Old Town',
      images: [
        { id: 'location-image-1', locationId: 'location-1', imageIndex: 0, description: '雨夜街道 A' },
        { id: 'location-image-2', locationId: 'location-1', imageIndex: 1, description: '雨夜街道 B' },
        { id: 'location-image-3', locationId: 'location-1', imageIndex: 2, description: '雨夜街道 C' },
      ],
    })

    const result = await handleLocationImageTask(buildJob({ locationId: 'location-1', count: 1 }, 'location-1'))

    expect(result).toEqual({
      updated: 1,
      locationIds: ['location-1'],
    })
    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledTimes(1)
    expect(textEngineMock.executeAiTextStep).toHaveBeenCalledTimes(1)
    expect(prismaMock.locationImage.update).toHaveBeenCalledTimes(2)
    expect(prismaMock.locationImage.update).toHaveBeenCalledWith({
      where: { id: 'location-image-1' },
      data: {
        imageUrl: 'cos/location-generated-1.png',
        spatialProfileStatus: 'stale',
        spatialProfileError: null,
      },
    })
    expect(prismaMock.projectLocation.update).toHaveBeenCalledWith({
      where: { id: 'location-1' },
      data: { selectedImageId: 'location-image-1' },
    })
  })

  it('uses the same aspect ratio as character generation for prop images', async () => {
    await handleLocationImageTask(buildJob({ type: 'prop', imageIndex: 0 }))

    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ aspectRatio: PROP_IMAGE_RATIO }),
      }),
    )
    expect(spatialProfileServiceMock.analyzeAndPersistProjectLocationImageSpatialProfile).not.toHaveBeenCalled()
  })
})
