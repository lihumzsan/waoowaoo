import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ProjectEditScriptUpdateArgs {
  readonly data?: {
    readonly videoBlocksJson?: unknown
  }
}

interface AiTextStepCall {
  readonly messages?: readonly {
    readonly content?: unknown
  }[]
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
  projectCharacter: {
    findFirst: vi.fn(),
  },
  projectLocation: {
    findFirst: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
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
    EDIT_SCRIPT_VIDEO_BLOCK_MERGE: 'edit-script-video-block-merge',
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
vi.mock('@/lib/assets/services/asset-actions', () => ({ submitAssetGenerateTask: vi.fn() }))

import { mergeProjectEditScriptVideoBlocks } from '@/lib/edit-script/video-block-merge'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts'

function buildStyleBibleJson() {
  return {
    strategy: 'style_bible',
    rawUserStyle: null,
    styleSummary: 'Cinematic realism.',
    stylePolicy: {
      visual: {
        negativePrompt: 'No distortion or unreadable frames.',
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
      hardBans: ['No subtitles.'],
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
        reason: 'first half movement',
        prompt: 'first half prompt',
      },
      {
        kind: 'group',
        shotNumbers: [3, 4],
        gridMode: '2x2',
        reason: 'second half continuation',
        prompt: 'second half prompt',
      },
    ],
    requirements: [],
  }
}

describe('edit script video block merge', () => {
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
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      artStyle: 'cinematic',
      videoRatio: '16:9',
    })
    prismaMock.projectCharacter.findFirst.mockResolvedValue(null)
    prismaMock.projectLocation.findFirst.mockResolvedValue(null)
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.task.findMany.mockResolvedValue([])
    aiExecMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        shotNumbers: [1, 2, 3, 4],
        reason: 'one continuous crossing action',
        prompt: 'merged continuous timed prompt',
      }),
    })
  })

  it('merges adjacent blocks with an AI-fused prompt and writes one group block', async () => {
    const result = await mergeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      leftBlockIndex: 0,
      rightBlockIndex: 1,
      userId: 'user-1',
      locale: 'en',
    })

    expect(result.videoBlocks).toEqual([
      {
        kind: 'group',
        shotNumbers: [1, 2, 3, 4],
        gridMode: '2x2',
        reason: 'one continuous crossing action',
        prompt: 'merged continuous timed prompt',
      },
    ])
    expect(prismaMock.projectEditScript.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'edit-1' },
      data: {
        videoBlocksJson: [
          {
            kind: 'group',
            shotNumbers: [1, 2, 3, 4],
            gridMode: '2x2',
            reason: 'one continuous crossing action',
            prompt: 'merged continuous timed prompt',
          },
        ],
      },
    }))
    expect(aiExecMock.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_VIDEO_BLOCK_MERGE,
    }))
    const firstAiCall = aiExecMock.executeAiTextStep.mock.calls[0]?.[0] as AiTextStepCall | undefined
    const prompt = String(firstAiCall?.messages?.[0]?.content)
    expect(prompt).toContain('first half prompt')
    expect(prompt).toContain('second half prompt')
  })

  it('rejects merged duration above fifteen seconds before calling AI or writing data', async () => {
    prismaMock.projectEditScript.findFirst.mockResolvedValue(buildScript([5, 5, 4, 2]))

    await expect(mergeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      leftBlockIndex: 0,
      rightBlockIndex: 1,
      userId: 'user-1',
      locale: 'en',
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'EDIT_SCRIPT_VIDEO_BLOCK_MERGE_DURATION_EXCEEDED',
        durationSec: 16,
        maxDurationSec: 15,
      }),
    })

    expect(aiExecMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.update).not.toHaveBeenCalled()
  })
})
