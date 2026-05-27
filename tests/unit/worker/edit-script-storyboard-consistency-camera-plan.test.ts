import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectStoryboard: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  projectStoryboardBlockingArtifact: {
    update: vi.fn(async () => ({})),
  },
  $transaction: vi.fn(),
}))

const modelGenerationMock = vi.hoisted(() => ({
  generateCameraPlan: vi.fn(),
}))

const persistenceMock = vi.hoisted(() => ({
  upsertEditScriptStoryboardShell: vi.fn(),
  upsertStoryboardPanelsFromPrompts: vi.fn(),
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(),
}))

const workerUtilsMock = vi.hoisted(() => ({
  resolveImageSourceFromGeneration: vi.fn(),
  toSignedUrlIfCos: vi.fn(),
  uploadImageSourceToCos: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/storage', () => ({
  generateUniqueKey: vi.fn(),
  getObjectBuffer: vi.fn(),
  uploadObject: vi.fn(),
}))
vi.mock('@/lib/media/service', () => ({ ensureMediaObjectFromStorageKey: vi.fn() }))
vi.mock('@/lib/workers/utils', () => workerUtilsMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => ({
  normalizeReferenceImageItemsForGeneration: vi.fn(),
}))
vi.mock('@/lib/edit-script/storyboard-consistency/model-generation', () => modelGenerationMock)
vi.mock('@/lib/edit-script/storyboard-consistency/persistence', () => persistenceMock)

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-camera-plan-1',
      type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
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

function buildSourceSnapshot() {
  return {
    schemaVersion: 1,
    projectId: 'project-1',
    episodeId: 'episode-1',
    sourceEditScriptId: 'edit-script-1',
    project: {
      videoRatio: '16:9',
    },
    styleBible: {
      strategy: 'style_bible',
      rawUserStyle: 'temple lesson',
      styleSummary: 'quiet temple style',
      stylePolicy: {
        visual: {
          negativePrompt: 'no text',
          imageFilterPrompt: 'soft natural light',
          lightingPrompt: 'soft light',
          colorPrompt: 'muted colors',
          texturePrompt: 'stone and wood',
          compositionPrompt: 'balanced frame',
        },
        camera: {
          movementPrompt: 'static',
          lensAndDepthPrompt: '35mm natural depth',
          videoRhythmPrompt: 'slow rhythm',
        },
        sound: {
          soundFilterPrompt: 'quiet wind',
        },
        hardBans: ['no text'],
      },
    },
    editScript: {
      id: 'edit-script-1',
      title: 'Temple Lesson',
      logline: null,
      durationSec: 8,
      shotCount: 1,
      userPrompt: 'temple lesson',
      screenplayText: null,
    },
    shots: [{
      shotNumber: 1,
      durationSec: 8,
      visualAction: 'Old monk teaches the young disciple.',
      charactersAndScene: 'Temple courtyard',
      camera: 'medium shot',
      videoPrompt: 'Temple lesson.',
      sound: 'wind',
    }],
    videoBlocks: [{
      kind: 'single',
      shotNumbers: [1],
      reason: 'Fixed courtyard blocking.',
      prompt: 'Temple lesson.',
      blockIndex: 0,
      sourceVideoBlockId: 'edit-script-1:videoBlock:1',
    }],
    assets: [],
  }
}

describe('edit script storyboard camera plan handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const sourceSnapshot = buildSourceSnapshot()
    prismaMock.projectStoryboard.findFirst.mockResolvedValue({
      id: 'storyboard-1',
      photographyPlan: JSON.stringify({
        currentStage: 'spatial_profile_ready',
        sourceSnapshot,
        modelConfigSnapshot: {
          analysisModel: 'analysis-model-1',
          storyboardModel: 'storyboard-model-1',
        },
        strategyOutput: {
          strategy: 'spatial_text_blocking',
          locations: [],
        },
      }),
      blockingArtifacts: [],
    })
    modelGenerationMock.generateCameraPlan.mockResolvedValue({
      cameraPlanOutput: {
        strategy: 'spatial_text_blocking',
        blocks: [{
          sourceVideoBlockId: 'edit-script-1:videoBlock:1',
          panels: [{
            panelIndex: 0,
            sourceShotNumber: 1,
            sourceVideoBlockId: 'edit-script-1:videoBlock:1',
            finalPanelPrompt: 'large prompt that belongs on ProjectPanel, not photographyPlan',
          }],
        }],
        panels: [{
          panelIndex: 0,
          sourceShotNumber: 1,
          sourceVideoBlockId: 'edit-script-1:videoBlock:1',
          shotScale: 'Medium shot',
          cameraPosition: 'front',
          cameraHeight: 'eye-level',
          cameraAngle: 'straight-on',
          composition: 'balanced',
          cameraMovement: 'static',
          lensAndDepth: '35mm',
          screenDirection: 'left to right',
          aestheticIntent: 'quiet',
          emotionalEffect: 'calm',
          continuityNote: 'same space',
          shotBlocking: {
            locationName: 'Temple courtyard',
            absolutePosition: 'courtyard midground',
            relativePosition: 'old monk near disciple',
            screenPosition: 'center frame',
            characterPlacements: [{
              characterName: 'Old monk',
              absolutePosition: 'courtyard midground',
              relativePosition: 'near disciple',
              screenPosition: 'center frame',
              facing: 'toward disciple',
              eyeline: 'toward disciple',
            }],
            cameraPlacement: 'front of courtyard',
            composition: 'balanced',
            continuityNote: 'same space',
          },
          finalPanelPrompt: 'large prompt that belongs on ProjectPanel, not photographyPlan',
        }],
      },
      panels: [{
        panelIndex: 0,
        sourceShotNumber: 1,
        sourceVideoBlockId: 'edit-script-1:videoBlock:1',
        prompt: 'storyboard prompt',
        metadata: {},
      }],
    })
    persistenceMock.upsertStoryboardPanelsFromPrompts.mockResolvedValue([
      { id: 'panel-1', panelIndex: 0 },
    ])
    workerUtilsMock.toSignedUrlIfCos.mockReturnValue('https://cdn.example.com/overlay-signed.png')
  })

  it('persists panel prompts without enqueueing panel image tasks', async () => {
    const { handleEditScriptStoryboardCameraPlanTask } = await import(
      '@/lib/workers/handlers/edit-script-storyboard-consistency-task-handler'
    )

    const result = await handleEditScriptStoryboardCameraPlanTask(buildJob())

    expect(result).toEqual({ storyboardId: 'storyboard-1', panelCount: 1 })
    expect(persistenceMock.upsertStoryboardPanelsFromPrompts).toHaveBeenCalledWith(expect.objectContaining({
      storyboardId: 'storyboard-1',
      locale: 'zh',
    }))
    expect(prismaMock.projectStoryboard.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'storyboard-1' },
      data: expect.objectContaining({
        lastError: null,
      }),
    }))
    const updateCalls = prismaMock.projectStoryboard.update.mock.calls as unknown as Array<[{
      readonly data?: {
        readonly photographyPlan?: string
      }
    }]>
    const storedPlan = JSON.parse(String(updateCalls[0]?.[0].data?.photographyPlan))
    expect(storedPlan.cameraPlanOutput).toEqual({
      strategy: 'spatial_text_blocking',
      panels: [{
        panelIndex: 0,
        sourceShotNumber: 1,
        sourceVideoBlockId: 'edit-script-1:videoBlock:1',
        shotScale: 'Medium shot',
        cameraPosition: 'front',
        cameraHeight: 'eye-level',
        cameraAngle: 'straight-on',
        composition: 'balanced',
        cameraMovement: 'static',
        lensAndDepth: '35mm',
        screenDirection: 'left to right',
        aestheticIntent: 'quiet',
        emotionalEffect: 'calm',
        continuityNote: 'same space',
        shotBlocking: {
          locationName: 'Temple courtyard',
          absolutePosition: 'courtyard midground',
          relativePosition: 'old monk near disciple',
          screenPosition: 'center frame',
          characterPlacements: [{
            characterName: 'Old monk',
            absolutePosition: 'courtyard midground',
            relativePosition: 'near disciple',
            screenPosition: 'center frame',
            facing: 'toward disciple',
            eyeline: 'toward disciple',
          }],
          cameraPlacement: 'front of courtyard',
          composition: 'balanced',
          continuityNote: 'same space',
        },
      }],
    })
    expect(JSON.stringify(storedPlan.cameraPlanOutput)).not.toContain('finalPanelPrompt')
    expect(JSON.stringify(storedPlan.cameraPlanOutput)).not.toContain('blocks')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})
