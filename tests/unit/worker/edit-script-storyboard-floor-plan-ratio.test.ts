import type { Job } from 'bullmq'
import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectStoryboard: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  projectStoryboardBlockingArtifact: {
    update: vi.fn(async () => ({})),
    upsert: vi.fn(async () => ({})),
  },
}))

const storageMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn(() => 'images/edit-script-storyboard-grid-overlay/overlay.png'),
  getObjectBuffer: vi.fn(),
  uploadObject: vi.fn(async () => 'images/edit-script-storyboard-grid-overlay/overlay.png'),
}))

const mediaServiceMock = vi.hoisted(() => ({
  ensureMediaObjectFromStorageKey: vi.fn(),
}))

const workerUtilsMock = vi.hoisted(() => ({
  resolveImageSourceFromGeneration: vi.fn(),
  toSignedUrlIfCos: vi.fn(() => 'https://cdn.example.com/location.png'),
  uploadImageSourceToCos: vi.fn(async () => 'images/floor-plan.png'),
}))

const imageReferenceMock = vi.hoisted(() => ({
  normalizeReferenceImageItemsForGeneration: vi.fn(),
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(async () => ({ taskId: 'task-grid-analyze-1' })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/media/service', () => mediaServiceMock)
vi.mock('@/lib/workers/utils', () => workerUtilsMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => imageReferenceMock)
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))

function buildSourceSnapshot() {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    episodeId: 'episode-1',
    sourceEditScriptId: 'edit-script-1',
    project: {
      videoRatio: '16:9',
    },
    editScript: {
      id: 'edit-script-1',
      title: 'Square Room',
      logline: null,
      durationSec: 8,
      shotCount: 1,
      userPrompt: 'square room',
      screenplayText: null,
    },
    styleBible: {
      strategy: 'style_bible',
      rawUserStyle: 'plain',
      styleSummary: 'plain',
      stylePolicy: {
        rawUserStyle: 'plain',
        styleSummary: 'plain',
        visual: {
          positivePrompt: 'plain',
          negativePrompt: 'none',
          imageFilterPrompt: 'plain',
          lightingPrompt: 'plain',
          colorPrompt: 'plain',
          texturePrompt: 'plain',
          compositionPrompt: 'plain',
        },
        camera: {
          rhythmPrompt: 'plain',
          movementPrompt: 'plain',
          lensAndDepthPrompt: 'plain',
          editingPacingPrompt: 'plain',
        },
        motion: {
          subjectMotionPrompt: 'plain',
          actingPrompt: 'plain',
        },
        sound: {
          positivePrompt: 'plain',
          negativePrompt: 'none',
          soundFilterPrompt: 'plain',
          soundStylePrompt: 'plain',
        },
        hardBans: ['No labels.'],
      },
    },
    shots: [{
      shotNumber: 1,
      durationSec: 8,
      visualAction: 'A person stands in the same room.',
      charactersAndScene: 'Square room',
      camera: 'medium shot',
      videoPrompt: 'Square room.',
      sound: 'room tone',
    }],
    videoBlocks: [{
      kind: 'single',
      shotNumbers: [1],
      reason: 'Fixed room blocking.',
      prompt: 'Square room.',
      blockIndex: 0,
      sourceVideoBlockId: 'edit-script-1:videoBlock:1',
    }],
    assets: [{
      requirementId: 'location-req-1',
      kind: 'location',
      name: 'Square room',
      description: 'A square top-down room.',
      shotNumbers: [1],
      targetId: 'location-1',
      previewImageUrl: 'images/location-square.png',
    }],
  }
}

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-floor-plan-1',
      type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectStoryboard',
      targetId: 'storyboard-1',
      payload: {
        storyboardId: 'storyboard-1',
      },
      userId: 'user-1',
      trace: {
        requestId: 'request-1',
      },
    },
  } as unknown as Job<TaskJobData>
}

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

describe('edit script storyboard floor plan ratio', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const squareDataUrl = await buildPngDataUrl(64, 64)
    const squareBuffer = Buffer.from(squareDataUrl.slice(squareDataUrl.indexOf(';base64,') + ';base64,'.length), 'base64')
    imageReferenceMock.normalizeReferenceImageItemsForGeneration.mockResolvedValue({
      referenceImages: [squareDataUrl],
      referenceImagesMap: [{ image_no: '图 1', role: 'location', name: 'Square room' }],
    })
    workerUtilsMock.resolveImageSourceFromGeneration.mockResolvedValue(squareDataUrl)
    storageMock.getObjectBuffer.mockResolvedValue(squareBuffer)
    mediaServiceMock.ensureMediaObjectFromStorageKey
      .mockResolvedValueOnce({ id: 'media-floor-plan', url: 'm/floor-plan' })
      .mockResolvedValueOnce({ id: 'media-overlay', url: 'm/overlay' })
    prismaMock.projectStoryboard.findFirst.mockResolvedValue({
      id: 'storyboard-1',
      photographyPlan: JSON.stringify({
        currentStage: 'floor_plan_prompts_ready',
        sourceSnapshot: buildSourceSnapshot(),
        modelConfigSnapshot: {
          analysisModel: 'analysis-model-1',
          storyboardModel: 'storyboard-model-1',
        },
      }),
      blockingArtifacts: [{
        id: 'floor-plan-1',
        kind: 'grid_floor_plan',
        status: 'pending',
        prompt: '生成正方形房间的俯视 2D 平面图。',
        sourceVideoBlockId: 'edit-script-1:videoBlock:1',
        groupIndex: 0,
        metadataJson: {
          skipped: false,
          locationTargetId: 'location-1',
          grid: { columns: 16, rows: 9, ratio: '16:9', shortSideUnits: 9 },
        },
      }],
    })
  })

  it('uses the scene reference image ratio for floor-plan generation and derives overlay grid from actual output dimensions', async () => {
    const { handleEditScriptStoryboardFloorPlanImageTask } = await import(
      '@/lib/workers/handlers/edit-script-storyboard-consistency-task-handler'
    )

    await handleEditScriptStoryboardFloorPlanImageTask(buildJob())

    expect(workerUtilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'storyboard-model-1',
      options: expect.objectContaining({
        aspectRatio: '1:1',
      }),
    }))
    const generationCall = workerUtilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1]
    expect(generationCall?.prompt).toContain('输出画布必须保持场景参考图的原始比例：1:1')

    expect(prismaMock.projectStoryboardBlockingArtifact.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        metadataJson: expect.objectContaining({
          grid: { columns: 9, rows: 9, ratio: '1:1', shortSideUnits: 9 },
        }),
      }),
      create: expect.objectContaining({
        metadataJson: expect.objectContaining({
          grid: { columns: 9, rows: 9, ratio: '1:1', shortSideUnits: 9 },
        }),
      }),
    }))
  })
})
