import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectStoryboard: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  projectStoryboardBlockingArtifact: {
    deleteMany: vi.fn(async () => ({})),
    createMany: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
  },
  $transaction: vi.fn(),
}))

const modelGenerationMock = vi.hoisted(() => ({
  generateStoryboardPanelFinalPrompts: vi.fn(),
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
  const sourceSnapshot = buildSourceSnapshotWithLocation()
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
        editScriptId: 'edit-script-1',
        storyboardId: 'storyboard-1',
        sourceSnapshot,
        modelConfigSnapshot: {
          analysisModel: 'analysis-model-1',
          storyboardModel: 'storyboard-model-1',
        },
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
        directing: {
          pointOfViewPrompt: 'restricted protagonist viewpoint',
          performancePrompt: 'restrained performance through small gestures',
          informationReleasePrompt: 'reveal information through reaction before event truth',
          rhythmPrompt: 'hold suspense pauses before faster turns',
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
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: 'Old monk teaches the young disciple.',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
      charactersAndScene: 'Temple courtyard',
      sound: 'wind',
    }],
    directorDecoupage: {
      shots: [{
        shotNumber: 1,
        durationSec: 8,
        dramaticPurpose: 'test dramatic purpose',
        visibleAction: 'Old monk teaches the young disciple.',
        audienceFocus: 'test audience focus',
        viewpoint: 'test viewpoint',
        revealPlan: 'test reveal plan',
        performanceBeat: 'test performance beat',
        continuityIn: 'test continuity in',
        continuityOut: 'test continuity out',
        charactersAndScene: 'Temple courtyard',
        sound: 'wind',
      }],
      hardBans: ['no text'],
    },
    cinematographyShotPlan: {
      shots: [{
        shotNumber: 1,
        shotScale: 'Medium shot',
        lens: '35mm',
        depthOfField: 'natural depth',
        cameraPosition: 'front',
        cameraHeight: 'eye-level',
        cameraAngle: 'straight-on',
        movement: 'static',
        composition: 'balanced',
        lighting: 'soft light',
        axisAndEyeline: 'left to right',
        continuityIn: 'test continuity in',
        continuityOut: 'test continuity out',
      }],
      hardBans: ['no text'],
    },
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

function buildSourceSnapshotWithLocation() {
  return {
    ...buildSourceSnapshot(),
    assets: [{
      requirementId: 'loc-1',
      kind: 'location',
      name: 'Temple courtyard',
      description: 'courtyard with a flower bed',
      shotNumbers: [1],
      targetId: 'location-1',
      previewImageUrl: 'https://cdn.example.com/courtyard.png',
      spatialProfile: {
        schemaVersion: 1,
        sceneSummary: '左后方是木门，中景有香炉。',
        anchors: [{
          id: 'anchor_left_door',
          label: '左侧木门',
          screenArea: '画面左后方',
          depthLayer: '背景',
          spatialRelations: ['木门右侧是长桌'],
        }],
        depthLayout: {
          foreground: '石板地面',
          midground: '香炉',
          background: '木门和墙面',
        },
        lightingDirection: '光线从右上方进入',
      },
    }],
  }
}

describe('edit script storyboard camera plan handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock))
    const sourceSnapshot = buildSourceSnapshotWithLocation()
    prismaMock.projectStoryboard.findFirst.mockResolvedValue({
      id: 'storyboard-1',
      photographyPlan: JSON.stringify({
        currentStage: 'spatial_profile_ready',
        sourceEditScriptId: sourceSnapshot.sourceEditScriptId,
        modelConfigSnapshot: {
          analysisModel: 'analysis-model-1',
          storyboardModel: 'storyboard-model-1',
        },
      }),
      blockingArtifacts: [],
    })
    modelGenerationMock.generateStoryboardPanelFinalPrompts.mockResolvedValue({
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
          finalVideoPrompt: 'video prompt that belongs on ProjectPanel, not photographyPlan',
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

  it('keeps large spatial profile data out of photographyPlan during prepare', async () => {
    const { handleEditScriptStoryboardPrepareTask } = await import(
      '@/lib/workers/handlers/edit-script-storyboard-consistency-task-handler'
    )
    const sourceSnapshot = buildSourceSnapshotWithLocation()
    persistenceMock.upsertEditScriptStoryboardShell.mockResolvedValue({
      id: 'storyboard-prepare-1',
    })
    submitterMock.submitTask.mockResolvedValue({
      taskId: 'camera-plan-task-1',
    })
    const job = {
      data: {
        ...buildJob().data,
        type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE,
        targetType: 'ProjectEditScript',
        targetId: 'edit-script-1',
        payload: {
          editScriptId: 'edit-script-1',
          sourceSnapshot,
          modelConfigSnapshot: {
            analysisModel: 'analysis-model-1',
            storyboardModel: 'storyboard-model-1',
          },
        },
      },
    } as unknown as Job<TaskJobData>

    const result = await handleEditScriptStoryboardPrepareTask(job)

    expect(result).toEqual({
      storyboardId: 'storyboard-prepare-1',
      spatialProfileCount: 1,
      nextTaskId: 'camera-plan-task-1',
    })
    expect(prismaMock.projectStoryboardBlockingArtifact.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        storyboardId: 'storyboard-prepare-1',
        kind: 'spatial_profile',
        metadataJson: expect.objectContaining({
          name: 'Temple courtyard',
          spatialProfile: expect.objectContaining({
            sceneSummary: '左后方是木门，中景有香炉。',
          }),
        }),
      })],
    })
    const shellPlan = persistenceMock.upsertEditScriptStoryboardShell.mock.calls[0]?.[0]?.photographyPlan as Record<string, unknown>
    expect(shellPlan).toMatchObject({
      currentStage: 'preparing',
      sourceEditScriptId: 'edit-script-1',
    })
    expect(shellPlan).not.toHaveProperty('sourceSnapshot')
    expect(shellPlan).not.toHaveProperty('strategyOutput')
    const updateCalls = prismaMock.projectStoryboard.update.mock.calls as unknown as Array<[{
      readonly data?: {
        readonly photographyPlan?: string
      }
    }]>
    const updatePlan = JSON.parse(String(updateCalls[0]?.[0].data?.photographyPlan)) as Record<string, unknown>
    expect(updatePlan).toMatchObject({
      currentStage: 'spatial_profile_ready',
      sourceEditScriptId: 'edit-script-1',
    })
    expect(updatePlan).not.toHaveProperty('sourceSnapshot')
    expect(updatePlan).not.toHaveProperty('strategyOutput')
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
