import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const txMock = vi.hoisted(() => ({
  projectEditScript: {
    upsert: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  projectEditAssetRequirement: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
    create: vi.fn(),
  },
  projectCharacter: {
    create: vi.fn(),
  },
  projectLocation: {
    create: vi.fn(),
  },
}))

const prismaMock = vi.hoisted(() => ({
  projectEpisode: {
    findFirst: vi.fn(),
  },
  project: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  projectEditScript: {
    upsert: vi.fn(),
    findFirst: vi.fn(),
  },
  projectEditScreenplay: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  projectEditDirectorDecoupage: {
    findFirst: vi.fn(),
  },
  projectCharacter: {
    findMany: vi.fn(),
  },
  projectLocation: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
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
vi.mock('@/lib/edit-script/asset-design', () => ({
  designEditAssetRequirements: vi.fn(async (input: { requirements: unknown }) => input.requirements),
}))
vi.mock('@/lib/assets/services/asset-actions', () => ({ submitAssetGenerateTask: vi.fn() }))

import {
  generateProjectEditScreenplay,
  generateProjectEditScript,
  readProjectEditScreenplay,
  readProjectEditScript,
} from '@/lib/edit-script/service'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts'

function createRequest(): NextRequest {
  return new Request('http://localhost/api/projects/project-1/edit-script', {
    method: 'POST',
    headers: { 'accept-language': 'zh' },
  }) as unknown as NextRequest
}

const mockStyleBible = {
  strategy: 'style_bible',
  rawUserStyle: '科幻短片',
  styleSummary: 'quiet realistic sci-fi',
  stylePolicy: {
    visual: {
      negativePrompt: '不要字幕，不要水印，不要廉价塑料科幻感。',
      imageFilterPrompt: 'low contrast, clean futuristic texture, subtle bloom, 35mm lens',
      lightingPrompt: 'cold practical lights and restrained bloom',
      colorPrompt: 'cool blue gray',
      texturePrompt: 'clean metal and glass texture',
      compositionPrompt: 'minimal corridor composition with negative space',
    },
    camera: {
      movementPrompt: 'slow controlled camera movement',
      lensAndDepthPrompt: '35mm lens with readable corridor depth',
      videoRhythmPrompt: 'slow push-in, restrained pacing',
    },
    directing: {
      pointOfViewPrompt: 'restricted protagonist viewpoint',
      performancePrompt: 'restrained performance through small gestures',
      informationReleasePrompt: 'reveal information through reaction before event truth',
      rhythmPrompt: 'hold suspense pauses before faster turns',
    },
    sound: {
      soundFilterPrompt: 'clean modern sci-fi sound, wide-band clarity, low mechanical hum, restrained spatial reverb',
    },
    hardBans: ['no subtitles'],
  },
}

function mockSuccessfulAiSteps() {
  aiExecMock.executeAiTextStep
    .mockResolvedValueOnce({
      text: JSON.stringify({
        title: 'Sci-Fi Short',
        logline: 'A quiet signal wakes a station.',
        durationSec: 4,
        shots: [
          {
            shotNumber: 1,
            durationSec: 4,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A station corridor flickers awake.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Station corridor',
            sound: 'low electrical hum',
          },
        ],
        videoBlocks: [
          {
            type: 'single',
            shotNumbers: [1],
            reason: 'Single establishing shot.',
          },
        ],
      }),
    })
    .mockResolvedValueOnce({
      text: JSON.stringify({
        assets: [
          {
            kind: 'location',
            name: 'Station Corridor',
            description: 'A cold sci-fi corridor.',
            shotNumbers: [1],
          },
        ],
      }),
    })
    .mockResolvedValueOnce({
      text: JSON.stringify({
        sourceVideoBlockIndex: 0,
        shotNumbers: [1],
        shots: [
          {
            shotNumber: 1,
          },
        ],
        videoBlock: {
          shotNumbers: [1],
          prompt: 'A cinematic station corridor flickers awake, slow push in.',
        },
      }),
    })
}

describe('edit script generation status persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    aiExecMock.executeAiTextStep.mockReset()
    prismaMock.projectEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    prismaMock.project.findFirst.mockResolvedValue({
      id: 'project-1',
      artStyle: 'realistic',
      videoRatio: '9:16',
    })
    prismaMock.projectCharacter.findMany.mockResolvedValue([])
    prismaMock.projectLocation.findMany.mockResolvedValue([])
    prismaMock.projectLocation.findFirst.mockResolvedValue(null)
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValue({
      id: 'screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '做一个科幻短片',
      styleBibleJson: mockStyleBible,
      screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      status: 'ready',
    })
    prismaMock.projectEditScreenplay.upsert.mockResolvedValue({
      id: 'screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '做一个科幻短片',
      styleBibleJson: mockStyleBible,
      screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      status: 'ready',
    })
    prismaMock.projectEditDirectorDecoupage.findFirst.mockResolvedValue({
      id: 'director-decoupage-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScreenplayId: 'screenplay-1',
      userPrompt: '做一个科幻短片',
      decoupageJson: {
        strategy: 'director_decoupage',
        schemaVersion: 1,
        shots: [
          {
            shotNumber: 1,
            durationSec: 4,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A station corridor flickers awake.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Station corridor',
            sound: 'low electrical hum',
          },
        ],
        hardBans: ['no subtitles'],
      },
      status: 'ready',
    })
    prismaMock.task.findFirst.mockResolvedValue(null)
    txMock.projectEditScript.upsert.mockResolvedValue({ id: 'edit-1' })
    txMock.projectEditAssetRequirement.deleteMany.mockResolvedValue({ count: 0 })
    txMock.projectEditAssetRequirement.createMany.mockResolvedValue({ count: 1 })
    txMock.projectEditAssetRequirement.create.mockResolvedValue({ id: 'req-1' })
    txMock.projectLocation.create.mockResolvedValue({ id: 'location-1' })
    txMock.projectCharacter.create.mockResolvedValue({
      id: 'character-1',
      appearances: [{ id: 'appearance-1' }],
    })
    txMock.projectEditScript.findUniqueOrThrow.mockResolvedValue({
      id: 'edit-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '做一个科幻短片',
      styleBibleJson: mockStyleBible,
      screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      title: 'Sci-Fi Short',
      logline: 'A quiet signal wakes a station.',
      durationSec: 4,
      shotCount: 1,
      status: 'ready',
      shotsJson: [
        {
          shotNumber: 1,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'A station corridor flickers awake.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Station corridor',
          sound: 'low electrical hum',
        },
      ],
      videoBlocksJson: [
        {
          kind: 'single',
          shotNumbers: [1],
          reason: 'Single establishing shot.',
          prompt: 'A cinematic station corridor flickers awake, slow push in.',
        },
      ],
      requirements: [],
    })
  })

  it('generates screenplay independently before edit script generation', async () => {
    aiExecMock.executeAiTextStep
      .mockResolvedValueOnce({
        text: JSON.stringify({ styleBible: mockStyleBible }),
      })
      .mockResolvedValueOnce({
        text: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      })

    const screenplay = await generateProjectEditScreenplay({
      request: createRequest(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
      prompt: '做一个科幻短片',
    })

    expect(screenplay.id).toBe('screenplay-1')
    expect(screenplay.styleBible).toEqual(mockStyleBible)
    expect(aiExecMock.executeAiTextStep).toHaveBeenCalledTimes(2)
    expect(aiExecMock.executeAiTextStep).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE,
      meta: expect.objectContaining({
        stepId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_BIBLE,
        stepIndex: 1,
        stepTotal: 2,
      }),
    }))
    expect(aiExecMock.executeAiTextStep).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
      meta: expect.objectContaining({
        stepId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
        stepIndex: 2,
        stepTotal: 2,
      }),
    }))
    expect(prismaMock.projectEditScreenplay.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        styleBibleJson: mockStyleBible,
        screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
        status: 'ready',
      }),
      update: expect.objectContaining({
        styleBibleJson: mockStyleBible,
        screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
        status: 'ready',
      }),
    }))
    expect(prismaMock.projectEditScript.upsert).not.toHaveBeenCalled()
  })

  it('reads legacy screenplay without Style Bible as nullable styleBible', async () => {
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValueOnce({
      id: 'legacy-screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '旧剧本',
      styleBibleJson: null,
      screenplayText: '旧剧本文本',
      status: 'ready',
    })

    const screenplay = await readProjectEditScreenplay({
      projectId: 'project-1',
      episodeId: 'episode-1',
    })

    expect(screenplay).toEqual({
      id: 'legacy-screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '旧剧本',
      styleBible: null,
      screenplayText: '旧剧本文本',
      status: 'ready',
    })
  })

  it('reads legacy edit script without Style Bible as nullable styleBible', async () => {
    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      id: 'legacy-edit-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '旧分镜',
      styleBibleJson: null,
      screenplayText: '旧剧本文本',
      title: '旧分镜',
      logline: null,
      durationSec: 4,
      shotCount: 1,
      status: 'ready',
      shotsJson: [
        {
          shotNumber: 1,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: '旧镜头动作',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: '旧场景',
          sound: '环境声',
        },
      ],
      videoBlocksJson: [
        {
          kind: 'single',
          shotNumbers: [1],
          reason: '单镜头',
          prompt: '旧视频块提示词',
        },
      ],
      requirements: [],
    })

    const editScript = await readProjectEditScript({
      projectId: 'project-1',
      episodeId: 'episode-1',
    })

    expect(editScript).toEqual(expect.objectContaining({
      id: 'legacy-edit-1',
      styleBible: null,
      title: '旧分镜',
      shotCount: 1,
      requirements: [],
    }))
    expect(editScript?.shots[0]).toEqual(expect.objectContaining({
      shotNumber: 1,
    }))
    expect(editScript?.videoBlocks[0]).toEqual(expect.objectContaining({
      prompt: '旧视频块提示词',
    }))
  })

  it('surfaces a failed asset regeneration even when an old preview image exists', async () => {
    prismaMock.projectLocation.findFirst.mockResolvedValueOnce({
      id: 'location-1',
      images: [
        {
          imageUrl: 'https://cdn.example.com/old-location.png',
          imageMediaId: null,
        },
      ],
    })
    prismaMock.task.findFirst.mockResolvedValueOnce({
      status: 'failed',
      errorMessage: 'IMAGE_PROVIDER_FAILED',
      errorCode: 'EXTERNAL_ERROR',
    })
    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      id: 'edit-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '做一个科幻短片',
      styleBibleJson: mockStyleBible,
      screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      title: 'Sci-Fi Short',
      logline: 'A quiet signal wakes a station.',
      durationSec: 4,
      shotCount: 1,
      status: 'ready',
      shotsJson: [
        {
          shotNumber: 1,
          durationSec: 4,
          dramaticPurpose: 'test dramatic purpose',
          visibleAction: 'A station corridor flickers awake.',
          audienceFocus: 'test audience focus',
          viewpoint: 'test viewpoint',
          revealPlan: 'test reveal plan',
          performanceBeat: 'test performance beat',
          continuityIn: 'test continuity in',
          continuityOut: 'test continuity out',
          charactersAndScene: 'Station corridor',
          sound: 'low electrical hum',
        },
      ],
      videoBlocksJson: [],
      requirements: [
        {
          id: 'requirement-1',
          kind: 'location',
          name: 'Station Corridor',
          description: 'A cold sci-fi corridor.',
          shotIndexes: [1],
          status: 'generating',
          targetId: 'location-1',
          errorMessage: null,
        },
      ],
    })

    const editScript = await readProjectEditScript({
      projectId: 'project-1',
      episodeId: 'episode-1',
    })

    expect(editScript?.requirements[0]).toEqual(expect.objectContaining({
      id: 'requirement-1',
      status: 'failed',
      errorMessage: 'IMAGE_PROVIDER_FAILED',
      previewImageUrl: 'https://cdn.example.com/old-location.png',
    }))
    expect(prismaMock.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: 'project-1',
        targetType: 'LocationImage',
        targetId: 'location-1',
      }),
      orderBy: { updatedAt: 'desc' },
    }))
  })

  it('persists a generating edit script before running the AI chain', async () => {
    mockSuccessfulAiSteps()

    await generateProjectEditScript({
      request: createRequest(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
    })

    expect(prismaMock.projectEditScript.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { episodeId: 'episode-1' },
      create: expect.objectContaining({
        status: 'generating',
        userPrompt: '做一个科幻短片',
        styleBibleJson: mockStyleBible,
        screenplayText: expect.stringContaining('标题：《科幻短片》'),
        shotCount: 0,
        shotsJson: [],
        videoBlocksJson: [],
      }),
      update: expect.objectContaining({
        status: 'generating',
        userPrompt: '做一个科幻短片',
        styleBibleJson: mockStyleBible,
        screenplayText: expect.stringContaining('标题：《科幻短片》'),
        shotCount: 0,
        shotsJson: [],
        videoBlocksJson: [],
      }),
    }))
    expect(prismaMock.projectEditScript.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      aiExecMock.executeAiTextStep.mock.invocationCallOrder[0],
    )
    expect(aiExecMock.executeAiTextStep).toHaveBeenCalledTimes(2)
    expect(aiExecMock.executeAiTextStep).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
      meta: expect.objectContaining({
        stepId: AI_PROMPT_IDS.EDIT_SCRIPT_PRIMARY,
        stepIndex: 1,
        stepTotal: 2,
      }),
    }))
    expect(aiExecMock.executeAiTextStep).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT,
      meta: expect.objectContaining({
        stepId: AI_PROMPT_IDS.EDIT_SCRIPT_ASSET_EXTRACT,
        stepIndex: 2,
        stepTotal: 2,
      }),
    }))
    expect(txMock.projectEditScript.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        styleBibleJson: mockStyleBible,
        screenplayText: expect.stringContaining('标题：《科幻短片》'),
      }),
      update: expect.objectContaining({
        status: 'ready',
        styleBibleJson: mockStyleBible,
        screenplayText: expect.stringContaining('标题：《科幻短片》'),
      }),
    }))
    expect(txMock.projectLocation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 'project-1',
        name: 'Station Corridor',
        summary: 'A cold sci-fi corridor.',
        images: expect.objectContaining({
          create: expect.objectContaining({
            imageIndex: 0,
            description: 'A cold sci-fi corridor.',
          }),
        }),
      }),
    }))
    expect(txMock.projectEditAssetRequirement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'Station Corridor',
        targetId: 'location-1',
        status: 'pending',
      }),
    }))
    expect(prismaMock.projectEditScript.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: 'generating',
        styleBibleJson: mockStyleBible,
        shotsJson: [
          expect.objectContaining({
            shotNumber: 1,
            dramaticPurpose: 'test dramatic purpose',
            visibleAction: 'A station corridor flickers awake.',
            audienceFocus: 'test audience focus',
            viewpoint: 'test viewpoint',
            revealPlan: 'test reveal plan',
            performanceBeat: 'test performance beat',
            continuityIn: 'test continuity in',
            continuityOut: 'test continuity out',
            charactersAndScene: 'Station corridor',
            sound: 'low electrical hum',
          }),
        ],
      }),
    }))
  })

  it('marks the persisted edit script failed when generation throws', async () => {
    aiExecMock.executeAiTextStep.mockRejectedValueOnce(new Error('LLM_DOWN'))

    await expect(generateProjectEditScript({
      request: createRequest(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
    })).rejects.toThrow('LLM_DOWN')

    expect(prismaMock.projectEditScript.upsert).toHaveBeenCalledTimes(2)
    expect(prismaMock.projectEditScript.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: 'failed',
        styleBibleJson: mockStyleBible,
        logline: 'LLM_DOWN',
      }),
    }))
  })
})
