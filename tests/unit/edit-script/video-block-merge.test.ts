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

const prismaMock = vi.hoisted(() => ({
  projectEditScript: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  projectVideoGroup: {
    findMany: vi.fn(),
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

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: 'analysis-model-1' })),
}))
vi.mock('@/lib/ai-exec/engine', () => aiExecMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/assets/services/asset-actions', () => ({ submitAssetGenerateTask: vi.fn() }))

import { mergeProjectEditScriptVideoBlocks } from '@/lib/edit-script/video-block-merge'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts'

function buildScript(durationOverrides: readonly number[] = [4, 4, 3, 3]) {
  const shotsJson = durationOverrides.map((durationSec, index) => {
    const shotNumber = index + 1
    return {
      shotNumber,
      durationSec,
      visualAction: `Shot ${shotNumber} action`,
      charactersAndScene: `Character / Room ${shotNumber}`,
      camera: `Camera ${shotNumber}`,
      videoPrompt: `Shot ${shotNumber} prompt`,
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
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      artStyle: 'cinematic',
      directorStyleDoc: 'restrained handheld realism',
      videoRatio: '16:9',
    })
    prismaMock.projectCharacter.findFirst.mockResolvedValue(null)
    prismaMock.projectLocation.findFirst.mockResolvedValue(null)
    prismaMock.task.findFirst.mockResolvedValue(null)
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
