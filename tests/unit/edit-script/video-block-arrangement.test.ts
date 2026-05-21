import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ProjectEditScriptUpdateArgs {
  readonly data?: {
    readonly videoBlocksJson?: unknown
  }
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

import { AI_PROMPT_IDS } from '@/lib/ai-prompts'
import { arrangeProjectEditScriptVideoBlocks } from '@/lib/edit-script/video-block-arrangement'

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
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      artStyle: 'cinematic',
      directorStyleDoc: 'restrained handheld realism',
      videoRatio: '16:9',
    })
    aiExecMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        videoBlocks: [
          {
            blockIndex: 0,
            shotNumbers: [1, 3, 2],
            reason: 'manual reordered continuity',
            prompt: 'rewritten reordered prompt',
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

  it('saves manually arranged shot order and rewrites changed block prompts', async () => {
    const result = await arrangeProjectEditScriptVideoBlocks({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      blocks: [
        { shotNumbers: [1, 3, 2] },
        { shotNumbers: [4] },
      ],
      userId: 'user-1',
      locale: 'en',
    })

    expect(result.videoBlocks).toEqual([
      {
        kind: 'group',
        shotNumbers: [1, 3, 2],
        gridMode: '2x2',
        reason: 'manual reordered continuity',
        prompt: 'rewritten reordered prompt',
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
            shotNumbers: [1, 3, 2],
            gridMode: '2x2',
            reason: 'manual reordered continuity',
            prompt: 'rewritten reordered prompt',
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
