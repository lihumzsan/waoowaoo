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
  projectEditStylePreview: {
    deleteMany: vi.fn(),
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
    update: vi.fn(),
  },
  projectEditStylePreview: {
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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
  $transaction: vi.fn(async (input: ((tx: typeof txMock) => Promise<unknown>) | readonly Promise<unknown>[]) => (
    typeof input === 'function' ? input(txMock) : Promise.all(input)
  )),
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
  buildDefaultTaskBillingInfo: vi.fn((_taskType: string, payload: Record<string, unknown>) => ({
    chargeType: 'free',
    billablePayload: payload,
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: 'analysis-model-1', storyboardModel: 'image-model-1' })),
  getUserModelConfig: vi.fn(async () => ({ capabilityDefaults: {} })),
  buildImageBillingPayloadFromUserConfig: vi.fn((input: { basePayload: Record<string, unknown>; imageModel: string | null }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
  })),
}))
vi.mock('@/lib/ai-exec/engine', () => aiExecMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/edit-script/asset-design', () => ({
  designEditAssetRequirements: vi.fn(async (input: { requirements: unknown }) => input.requirements),
}))
vi.mock('@/lib/assets/services/asset-actions', () => ({ submitAssetGenerateTask: vi.fn() }))
vi.mock('@/lib/task/submitter', () => ({
  submitTask: vi.fn(async () => ({ taskId: 'style-preview-task-1', status: 'queued' })),
}))
vi.mock('@/lib/storage', () => ({
  getSignedUrl: vi.fn((key: string) => `https://cdn.example.com/${key}`),
}))

import {
  confirmProjectEditStylePreview,
  generateProjectEditScreenplay,
  generateProjectEditScript,
  generateProjectEditStylePreviews,
  readProjectEditScreenplay,
  readProjectEditScript,
  reviseProjectEditScreenplay,
} from '@/lib/edit-script/service'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts'
import { submitTask } from '@/lib/task/submitter'

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

const mockStylePreviewOptions = {
  stylePreviews: [
    {
      styleKey: 'style_a',
      aspectRatio: '9:16',
      title: '静冷科幻',
      summary: '冷色、克制、空间感强。',
      styleBible: mockStyleBible,
      gridImagePrompt: 'Generate one 3x3 contact sheet from the screenplay in quiet realistic sci-fi style.',
    },
    {
      styleKey: 'style_b',
      aspectRatio: '16:9',
      title: '暖色悬疑',
      summary: '暖光、阴影、悬疑节奏。',
      styleBible: {
        ...mockStyleBible,
        styleSummary: 'warm suspense sci-fi',
      },
      gridImagePrompt: 'Generate one 3x3 contact sheet from the screenplay in warm suspense sci-fi style.',
    },
    {
      styleKey: 'style_c',
      aspectRatio: '21:9',
      title: '硬朗工业',
      summary: '工业质感、强结构、低饱和。',
      styleBible: {
        ...mockStyleBible,
        styleSummary: 'industrial realistic sci-fi',
      },
      gridImagePrompt: 'Generate one 3x3 contact sheet from the screenplay in industrial realistic sci-fi style.',
    },
  ],
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
    txMock.projectEditStylePreview.deleteMany.mockResolvedValue({ count: 0 })
    txMock.projectEditStylePreview.create.mockImplementation(async (input: {
      data: {
        projectId: string
        episodeId: string
        editScreenplayId: string
        styleKey: string
        aspectRatio: string
        title: string
        summary: string
        styleBibleJson: unknown
        imagePrompt: string
        status: string
      }
    }) => ({
      id: `style-preview-${input.data.styleKey}`,
      projectId: input.data.projectId,
      episodeId: input.data.episodeId,
      editScreenplayId: input.data.editScreenplayId,
      styleKey: input.data.styleKey,
      aspectRatio: input.data.aspectRatio,
      title: input.data.title,
      summary: input.data.summary,
      styleBibleJson: input.data.styleBibleJson,
      imagePrompt: input.data.imagePrompt,
      imageKey: null,
      status: input.data.status,
      taskId: null,
      errorMessage: null,
    }))
    prismaMock.projectEditStylePreview.update.mockResolvedValue({})
    prismaMock.projectEditStylePreview.deleteMany.mockResolvedValue({ count: 0 })
    prismaMock.projectEditStylePreview.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.projectEditStylePreview.findFirst.mockResolvedValue(null)
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

  it('generates screenplay for user review without starting style preview tasks', async () => {
    aiExecMock.executeAiTextStep
      .mockResolvedValueOnce({
        text: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      })
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValueOnce({
      id: 'screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '做一个科幻短片',
      styleBibleJson: null,
      screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      status: 'screenplay_ready',
      stylePreviews: [],
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
    expect(screenplay.styleBible).toBeNull()
    expect(screenplay.status).toBe('screenplay_ready')
    expect(screenplay.stylePreviews).toHaveLength(0)
    expect(aiExecMock.executeAiTextStep).toHaveBeenCalledTimes(1)
    expect(aiExecMock.executeAiTextStep).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
      meta: expect.objectContaining({
        stepId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY,
        stepIndex: 1,
        stepTotal: 1,
      }),
    }))
    expect(prismaMock.projectEditScreenplay.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
        status: 'screenplay_ready',
      }),
      update: expect.objectContaining({
        screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
        status: 'screenplay_ready',
      }),
    }))
    expect(prismaMock.projectEditStylePreview.deleteMany).toHaveBeenCalledWith({
      where: { editScreenplayId: 'screenplay-1' },
    })
    expect(txMock.projectEditStylePreview.create).not.toHaveBeenCalled()
    expect(prismaMock.projectEditStylePreview.update).not.toHaveBeenCalled()
    expect(submitTask).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.upsert).not.toHaveBeenCalled()
  })

  it('revises screenplay during review without starting style preview tasks', async () => {
    aiExecMock.executeAiTextStep.mockResolvedValueOnce({
      text: '标题：《深空低语》\n\n故事梗概：空间站收到不可名状的深海星图。',
    })
    prismaMock.projectEditScreenplay.findFirst
      .mockResolvedValueOnce({
        id: 'screenplay-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: '做一个60秒 16:9 科幻短片',
        styleBibleJson: null,
        screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
        status: 'screenplay_ready',
      })
      .mockResolvedValueOnce({
        id: 'screenplay-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: [
          '做一个60秒 16:9 科幻短片',
          '',
          '剧本修改要求：改得更克苏鲁一些',
          '剪辑先行结构化参数：目标总时长 60 秒；最终画面比例 16:9。',
        ].join('\n'),
        styleBibleJson: null,
        screenplayText: '标题：《深空低语》\n\n故事梗概：空间站收到不可名状的深海星图。',
        status: 'screenplay_ready',
        stylePreviews: [],
      })

    const screenplay = await reviseProjectEditScreenplay({
      request: createRequest(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
      revisionInstruction: '改得更克苏鲁一些',
      durationSeconds: 60,
      aspectRatio: '16:9',
    })

    expect(screenplay.status).toBe('screenplay_ready')
    expect(screenplay.screenplayText).toContain('不可名状')
    expect(aiExecMock.executeAiTextStep).toHaveBeenCalledTimes(1)
    expect(aiExecMock.executeAiTextStep).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION,
      meta: expect.objectContaining({
        stepId: AI_PROMPT_IDS.EDIT_SCRIPT_SCREENPLAY_REVISION,
        stepIndex: 1,
        stepTotal: 1,
      }),
    }))
    expect(prismaMock.projectEditScreenplay.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'screenplay-1' },
      data: expect.objectContaining({
        screenplayText: '标题：《深空低语》\n\n故事梗概：空间站收到不可名状的深海星图。',
        status: 'screenplay_ready',
      }),
    }))
    expect(prismaMock.projectEditStylePreview.deleteMany).toHaveBeenCalledWith({
      where: { editScreenplayId: 'screenplay-1' },
    })
    expect(txMock.projectEditStylePreview.create).not.toHaveBeenCalled()
    expect(prismaMock.projectEditStylePreview.update).not.toHaveBeenCalled()
    expect(submitTask).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.upsert).not.toHaveBeenCalled()
  })

  it('generates screenplay-based style preview tasks after screenplay review', async () => {
    aiExecMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify(mockStylePreviewOptions),
    })
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValueOnce({
      id: 'screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '做一个60秒 16:9 科幻短片',
      styleBibleJson: null,
      screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      status: 'screenplay_ready',
    })

    const result = await generateProjectEditStylePreviews({
      request: createRequest(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
      screenplayId: 'screenplay-1',
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      projectId: 'project-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
      status: 'queued',
      total: 3,
      taskIds: ['style-preview-task-1', 'style-preview-task-1', 'style-preview-task-1'],
    }))
    expect(result.stylePreviews.map((preview) => preview.styleKey)).toEqual(['style_a', 'style_b', 'style_c'])
    expect(aiExecMock.executeAiTextStep).toHaveBeenCalledTimes(1)
    expect(aiExecMock.executeAiTextStep).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS,
      meta: expect.objectContaining({
        stepId: AI_PROMPT_IDS.EDIT_SCRIPT_STYLE_PREVIEW_OPTIONS,
        stepIndex: 2,
        stepTotal: 2,
      }),
    }))
    expect(txMock.projectEditStylePreview.create).toHaveBeenCalledTimes(3)
    expect(txMock.projectEditStylePreview.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({
        styleKey: 'style_a',
        aspectRatio: '9:16',
      }),
    }))
    expect(prismaMock.projectEditScreenplay.update).toHaveBeenCalledWith({
      where: { id: 'screenplay-1' },
      data: {
        status: 'style_preview_generating',
      },
    })
    expect(prismaMock.projectEditStylePreview.update).toHaveBeenCalledTimes(3)
    expect(submitTask).toHaveBeenCalledTimes(3)
    expect(submitTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'edit_style_preview_image',
      targetType: 'ProjectEditStylePreview',
      targetId: 'style-preview-style_a',
      payload: expect.objectContaining({
        aspectRatio: '16:9',
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
      stylePreviews: [],
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
      stylePreviews: [],
      screenplayText: '旧剧本文本',
      status: 'ready',
    })
  })

  it('confirms a completed style preview with the user-selected aspect ratio', async () => {
    prismaMock.projectEditStylePreview.findFirst.mockResolvedValueOnce({
      id: 'style-preview-style_b',
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScreenplayId: 'screenplay-1',
      styleKey: 'style_b',
      aspectRatio: '16:9',
      title: '暖色悬疑',
      summary: '暖光、阴影、悬疑节奏。',
      styleBibleJson: mockStylePreviewOptions.stylePreviews[1].styleBible,
      imagePrompt: mockStylePreviewOptions.stylePreviews[1].gridImagePrompt,
      imageKey: 'style-preview/style-b.png',
      status: 'completed',
      taskId: 'style-preview-task-b',
      errorMessage: null,
      editScreenplay: {
        id: 'screenplay-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: '做一个科幻短片',
        styleBibleJson: null,
        screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
        status: 'style_preview_ready',
        stylePreviews: mockStylePreviewOptions.stylePreviews.map((preview) => ({
          id: `style-preview-${preview.styleKey}`,
          projectId: 'project-1',
          episodeId: 'episode-1',
          editScreenplayId: 'screenplay-1',
          styleKey: preview.styleKey,
          aspectRatio: preview.aspectRatio,
          title: preview.title,
          summary: preview.summary,
          styleBibleJson: preview.styleBible,
          imagePrompt: preview.gridImagePrompt,
          imageKey: `style-preview/${preview.styleKey}.png`,
          status: 'completed',
          taskId: `task-${preview.styleKey}`,
          errorMessage: null,
        })),
      },
    })
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValueOnce({
      id: 'screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      userPrompt: '做一个科幻短片',
      styleBibleJson: mockStylePreviewOptions.stylePreviews[1].styleBible,
      screenplayText: '标题：《科幻短片》\n\n故事梗概：一条安静信号唤醒空间站。',
      status: 'ready',
      stylePreviews: mockStylePreviewOptions.stylePreviews.map((preview) => ({
        id: `style-preview-${preview.styleKey}`,
        projectId: 'project-1',
        episodeId: 'episode-1',
        editScreenplayId: 'screenplay-1',
        styleKey: preview.styleKey,
        aspectRatio: preview.aspectRatio,
        title: preview.title,
        summary: preview.summary,
        styleBibleJson: preview.styleBible,
        imagePrompt: preview.gridImagePrompt,
        imageKey: `style-preview/${preview.styleKey}.png`,
        status: preview.styleKey === 'style_b' ? 'confirmed' : 'completed',
        taskId: `task-${preview.styleKey}`,
        errorMessage: null,
      })),
    })

    const screenplay = await confirmProjectEditStylePreview({
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      stylePreviewId: 'style-preview-style_b',
      aspectRatio: '9:16',
    })

    expect(prismaMock.projectEditStylePreview.updateMany).toHaveBeenCalledWith({
      where: {
        editScreenplayId: 'screenplay-1',
        status: 'confirmed',
      },
      data: {
        status: 'completed',
      },
    })
    expect(prismaMock.projectEditStylePreview.update).toHaveBeenCalledWith({
      where: { id: 'style-preview-style_b' },
      data: {
        status: 'confirmed',
        errorMessage: null,
      },
    })
    expect(prismaMock.projectEditScreenplay.update).toHaveBeenCalledWith({
      where: { id: 'screenplay-1' },
      data: {
        styleBibleJson: mockStylePreviewOptions.stylePreviews[1].styleBible,
        status: 'ready',
      },
    })
    expect(prismaMock.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: {
        videoRatio: '9:16',
      },
    })
    expect(screenplay.status).toBe('ready')
    expect(screenplay.styleBible?.styleSummary).toBe('warm suspense sci-fi')
    expect(screenplay.stylePreviews.find((preview) => preview.styleKey === 'style_b')?.status).toBe('confirmed')
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
