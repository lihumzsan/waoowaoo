import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ProjectEditScriptUpdateArgs {
  readonly data?: {
    readonly videoBlocksJson?: unknown
  }
}

interface PromptBuildInput {
  readonly variables?: Record<string, string>
}

const prismaMock = vi.hoisted(() => ({
  projectEditScript: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  projectVideoGroup: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  project: {
    findFirst: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
}))

const aiExecMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

const billingMock = vi.hoisted(() => ({
  withTextBilling: vi.fn(async (
    _userId: string,
    _model: string,
    _maxInputTokens: number,
    _billingMeta: unknown,
    runCompletion: () => Promise<unknown>,
  ) => await runCompletion()),
}))

const aiPromptsMock = vi.hoisted(() => ({
  AI_PROMPT_IDS: {
    EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT: 'edit-script-video-block-arrangement',
  },
  buildAiPrompt: vi.fn((input: PromptBuildInput) => Object.values(input.variables ?? {}).join('\n')),
  buildAiPromptContent: vi.fn((input: PromptBuildInput) => Object.values(input.variables ?? {}).join('\n')),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: 'analysis-model-1' })),
}))
vi.mock('@/lib/ai-exec/engine', () => aiExecMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/ai-prompts', () => aiPromptsMock)

import { AI_PROMPT_IDS } from '@/lib/ai-prompts'
import { arrangeProjectEditScriptVideoBlocks } from '@/lib/edit-script/video-block-arrangement'

function buildStyleBibleJson() {
  return {
    strategy: 'style_bible',
    rawUserStyle: null,
    styleSummary: 'Cinematic realism.',
    stylePolicy: {
      visual: {
        imageFilterPrompt: 'Clean cinematic image.',
        lightingPrompt: 'Soft contrast lighting.',
        colorPrompt: 'Cool neutral palette.',
        texturePrompt: 'Fine film grain.',
        compositionPrompt: 'Balanced composition.',
      },
      camera: {
        movementPrompt: 'Smooth camera movement.',
        lensAndDepthPrompt: '35mm lens with moderate depth.',
        videoRhythmPrompt: 'Steady visual rhythm with clear continuity pacing.',
      },
      directing: {
        pointOfViewPrompt: 'restricted protagonist viewpoint',
        performancePrompt: 'restrained performance through small gestures',
        informationReleasePrompt: 'reveal information through reaction before event truth',
        rhythmPrompt: 'hold suspense pauses before faster turns',
      },
      sound: {
        soundFilterPrompt: 'Clean room tone.',
      },
    },
  }
}

function buildScript(durationOverrides: readonly number[] = [4, 4, 3, 3]) {
  const shotsJson = durationOverrides.map((durationSec, index) => {
    const shotNumber = index + 1
    return {
      shotNumber,
      durationSec,
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: `Shot ${shotNumber} action`,
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
      charactersAndScene: `Character / Room ${shotNumber}`,
      sound: `Sound ${shotNumber}`,
    }
  })
  return {
    id: 'edit-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    userPrompt: 'make a short sci-fi scene',
    screenplayText: 'A continuous sci-fi scene.',
    title: 'Sci-Fi Scene',
    logline: 'A character crosses a room.',
    durationSec: durationOverrides.reduce((total, durationSec) => total + durationSec, 0),
    shotCount: durationOverrides.length,
    status: 'ready',
    shotsJson,
    styleBibleJson: buildStyleBibleJson(),
    videoBlocksJson: [
      {
        kind: 'group',
        shotNumbers: [1, 2],
        gridMode: '2x2',
        reason: 'first movement',
        prompt: 'first prompt',
      },
      {
        kind: 'group',
        shotNumbers: [3, 4],
        gridMode: '2x2',
        reason: 'second movement',
        prompt: 'second prompt',
      },
    ],
    requirements: [],
  }
}

describe('edit script video block arrangement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const script = buildScript()
    prismaMock.projectEditScript.findFirst.mockResolvedValue(script)
    prismaMock.projectEditScript.update.mockImplementation(async (args: ProjectEditScriptUpdateArgs) => ({
      ...script,
      videoBlocksJson: args.data?.videoBlocksJson,
    }))
    prismaMock.projectVideoGroup.findMany.mockResolvedValue([])
    prismaMock.projectVideoGroup.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.task.findMany.mockResolvedValue([])
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      artStyle: 'cinematic',
      videoRatio: '16:9',
    })
    aiExecMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        videoBlocks: [
          {
            blockIndex: 0,
            shotNumbers: [1, 2, 3],
            reason: 'manual adjacent continuity',
            prompt: 'rewritten adjacent prompt',
          },
          {
            blockIndex: 1,
            shotNumbers: [4],
            reason: 'remaining single beat',
            prompt: 'rewritten single prompt',
          },
        ],
      }),
    })
  })

  it('moves a boundary shot between adjacent video blocks and rewrites changed block prompts', async () => {
    const result = await arrangeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blocks: [
        { shotNumbers: [1, 2, 3] },
        { shotNumbers: [4] },
      ],
      userId: 'user-1',
      locale: 'en',
    })

    expect(result.videoBlocks).toEqual([
      {
        kind: 'group',
        shotNumbers: [1, 2, 3],
        gridMode: '2x2',
        reason: 'manual adjacent continuity',
        prompt: 'rewritten adjacent prompt',
      },
      {
        kind: 'single',
        shotNumbers: [4],
        reason: 'remaining single beat',
        prompt: 'rewritten single prompt',
      },
    ])
    expect(prismaMock.projectEditScript.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'edit-1' },
      data: {
        videoBlocksJson: [
          {
            kind: 'group',
            shotNumbers: [1, 2, 3],
            gridMode: '2x2',
            reason: 'manual adjacent continuity',
            prompt: 'rewritten adjacent prompt',
          },
          {
            kind: 'single',
            shotNumbers: [4],
            reason: 'remaining single beat',
            prompt: 'rewritten single prompt',
          },
        ],
      },
    }))
    expect(aiExecMock.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT,
    }))
  })

  it('rejects reordered shots before calling AI or writing data', async () => {
    await expect(arrangeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blocks: [
        { shotNumbers: [1, 3, 2] },
        { shotNumbers: [4] },
      ],
      userId: 'user-1',
      locale: 'en',
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_ORDER_INVALID',
        shotNumber: 3,
        expectedShotNumber: 2,
        position: 1,
      }),
    })

    expect(aiExecMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.update).not.toHaveBeenCalled()
  })

  it('repairs stale processing video groups whose linked task already failed before arranging', async () => {
    prismaMock.projectVideoGroup.findMany.mockResolvedValue([
      {
        id: 'group-1',
        status: 'processing',
        taskId: 'task-1',
        shotNumbers: [3, 4],
        videoUrl: '/m/old-video',
        videoMediaId: 'media-1',
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date('2026-05-20T11:02:12.040Z'),
      },
    ])
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        status: 'failed',
        errorCode: 'RECONCILE_ORPHAN',
        errorMessage: 'Queue job already terminated but DB was not updated',
      },
    ])
    prismaMock.projectVideoGroup.updateMany.mockResolvedValue({ count: 1 })

    const result = await arrangeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blocks: [
        { shotNumbers: [1, 2, 3] },
        { shotNumbers: [4] },
      ],
      userId: 'user-1',
      locale: 'en',
    })

    expect(result.videoBlocks[0]?.shotNumbers).toEqual([1, 2, 3])
    expect(prismaMock.projectVideoGroup.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        status: { in: ['queued', 'processing'] },
      },
      data: {
        status: 'failed',
        taskId: null,
        errorCode: 'RECONCILE_ORPHAN',
        errorMessage: 'Queue job already terminated but DB was not updated',
      },
    })
    expect(aiExecMock.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT,
    }))
  })

  it('still rejects recently queued video groups before the task link is visible', async () => {
    prismaMock.projectVideoGroup.findMany.mockResolvedValue([
      {
        id: 'group-1',
        status: 'queued',
        taskId: null,
        shotNumbers: [3, 4],
        videoUrl: '/m/previous-video',
        videoMediaId: 'previous-media-1',
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      },
    ])
    prismaMock.task.findMany.mockResolvedValue([])

    await expect(arrangeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blocks: [
        { shotNumbers: [1, 2, 3] },
        { shotNumbers: [4] },
      ],
      userId: 'user-1',
      locale: 'en',
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_RUNNING_VIDEO_GROUP',
        groupIds: ['group-1'],
      }),
    })

    expect(prismaMock.projectVideoGroup.updateMany).not.toHaveBeenCalled()
    expect(aiExecMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.update).not.toHaveBeenCalled()
  })

  it('still rejects when overlapping video group task is actually running', async () => {
    prismaMock.projectVideoGroup.findMany.mockResolvedValue([
      {
        id: 'group-1',
        status: 'processing',
        taskId: 'task-1',
        shotNumbers: [3, 4],
        videoUrl: null,
        videoMediaId: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date(),
      },
    ])
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        status: 'processing',
        errorCode: null,
        errorMessage: null,
      },
    ])

    await expect(arrangeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blocks: [
        { shotNumbers: [1, 2, 3] },
        { shotNumbers: [4] },
      ],
      userId: 'user-1',
      locale: 'en',
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_RUNNING_VIDEO_GROUP',
        groupIds: ['group-1'],
        shotNumbers: [3, 4],
      }),
    })

    expect(aiExecMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.update).not.toHaveBeenCalled()
  })

  it('rejects a manually arranged block above fifteen seconds before calling AI or writing data', async () => {
    prismaMock.projectEditScript.findFirst.mockResolvedValue(buildScript([5, 5, 6, 2]))

    await expect(arrangeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blocks: [
        { shotNumbers: [1, 2, 3] },
        { shotNumbers: [4] },
      ],
      userId: 'user-1',
      locale: 'en',
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_ARRANGEMENT_DURATION_EXCEEDED',
        durationSec: 16,
        maxDurationSec: 15,
      }),
    })

    expect(aiExecMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.update).not.toHaveBeenCalled()
  })
})
