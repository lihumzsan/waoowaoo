import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

type PanelRow = {
  id: string
  storyboardId: string
  panelIndex: number
  videoUrl: string | null
  imageUrl: string | null
  videoPrompt: string | null
  videoPromptEditedByUser?: boolean
  description: string | null
  firstLastFramePrompt: string | null
  firstLastFramePromptEditedByUser?: boolean
  duration: number | null
  shotType: string | null
  cameraMove: string | null
  location: string | null
  characters: string | null
  props: string | null
  srtSegment: string | null
  sceneType: string | null
  storyboard: {
    episodeId: string
    clip: {
      content: string | null
    } | null
  }
}

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
}))

const LTX23_DEFAULT_MODEL = 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2'
const LTX23_FIRST_LAST_MODEL = 'comfyui::basevideo/ltx23-profiles/t8-smooth-first-last-frame'
const LTX23_LARGE_MOTION_MODEL = 'comfyui::basevideo/ltx23-profiles/t8-single-image-large-motion-4stage'

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const withTaskLifecycleMock = vi.hoisted(() =>
  vi.fn(async (job: Job<TaskJobData>, handler: WorkerProcessor) => await handler(job)),
)

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ videoRatio: '16:9' })),
  resolveLipSyncVideoSource: vi.fn(async () => 'https://provider.example/lipsync.mp4'),
  resolveVideoSourceFromGeneration:
    vi.fn<(...args: unknown[]) => Promise<{ url: string; actualVideoTokens?: number; downloadHeaders?: Record<string, string> }>>(
      async () => ({ url: 'https://provider.example/video.mp4' }),
  ),
  toSignedUrlIfCos: vi.fn((url: string | null) => (url ? `https://signed.example/${url}` : null)),
  uploadImageSourceToCos: vi.fn<(...args: [unknown, string, string]) => Promise<string>>(
    async (_source: unknown, _prefix: string, targetId: string) => `images/${targetId}.jpg`,
  ),
  uploadVideoSourceToCos: vi.fn<(...args: [unknown, string, string, Record<string, string>?]) => Promise<string>>(
    async () => 'cos/lip-sync/video.mp4',
  ),
}))
const configServiceMock = vi.hoisted(() => ({
  getUserWorkflowConcurrencyConfig: vi.fn(async () => ({
    analysis: 5,
    image: 5,
    video: 5,
  })),
}))
const concurrencyGateMock = vi.hoisted(() => ({
  withUserConcurrencyGate: vi.fn(async <T>(input: {
    run: () => Promise<T>
  }) => await input.run()),
}))
const ltxPromptEnhanceMock = vi.hoisted(() => ({
  enhanceLtx23VideoPrompt: vi.fn(async (input: { originalPrompt: string }): Promise<{
    prompt: string
    enhanced: boolean
    textModel: string | null
  }> => ({
    prompt: input.originalPrompt,
    enhanced: false,
    textModel: null,
  })),
  isLtx23VideoModel: vi.fn((modelKey: string | null | undefined) => {
    const normalized = String(modelKey || '').toLowerCase()
    return normalized.includes('ltx2.3')
      || normalized.includes('ltx-2.3')
      || normalized.includes('/ltx')
      || normalized.includes('ltxv')
  }),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  novelPromotionVoiceLine: {
    findUnique: vi.fn(),
    findMany: vi.fn(async (): Promise<Array<{
      id: string
      speaker?: string | null
      content?: string | null
      audioDuration?: number | null
    }>> => []),
  },
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      void name
    }

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
    }
  },
  Worker: class {
    constructor(name: string, processor: WorkerProcessor) {
      void name
      workerState.processor = processor
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  withTaskLifecycle: withTaskLifecycleMock,
}))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn(async (input: string) => input),
}))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/model-config-contract', () => ({
  parseModelKeyStrict: vi.fn(() => ({ provider: 'fal' })),
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'api-key' })),
}))
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/workers/user-concurrency-gate', () => concurrencyGateMock)
vi.mock('@/lib/video-duration/ltx23-prompt-enhance', () => ltxPromptEnhanceMock)

function buildPanel(overrides?: Partial<PanelRow>): PanelRow {
  return {
    id: 'panel-1',
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    videoUrl: 'cos/base-video.mp4',
    imageUrl: 'cos/panel-image.png',
    videoPrompt: 'panel prompt',
    videoPromptEditedByUser: false,
    description: 'panel description',
    firstLastFramePrompt: null,
    firstLastFramePromptEditedByUser: false,
    duration: 5,
    shotType: '近景',
    cameraMove: '缓慢推进',
    location: '办公室',
    characters: '中年医生',
    props: '办公桌',
    srtSegment: '你好，我们开始吧。',
    sceneType: 'dialogue',
    storyboard: {
      episodeId: 'episode-1',
      clip: {
        content: '夜晚办公室对话。',
      },
    },
    ...(overrides || {}),
  }
}

function buildJob(params: {
  type: TaskJobData['type']
  payload?: Record<string, unknown>
  targetType?: string
  targetId?: string
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: params.type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: params.targetType ?? 'NovelPromotionPanel',
      targetId: params.targetId ?? 'panel-1',
      payload: params.payload ?? {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker video processor behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null
    utilsMock.getProjectModels.mockResolvedValue({ videoRatio: '16:9' })
    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValue({ url: 'https://provider.example/video.mp4' })
    utilsMock.resolveLipSyncVideoSource.mockResolvedValue('https://provider.example/lipsync.mp4')
    utilsMock.toSignedUrlIfCos.mockImplementation((url: string | null) => (url ? `https://signed.example/${url}` : null))
    utilsMock.uploadImageSourceToCos.mockImplementation(async (_source: unknown, _prefix: string, targetId: string) => `images/${targetId}.jpg`)
    utilsMock.uploadVideoSourceToCos.mockImplementation(async () => 'cos/lip-sync/video.mp4')
    ltxPromptEnhanceMock.enhanceLtx23VideoPrompt.mockImplementation(async (input: { originalPrompt: string }) => ({
      prompt: input.originalPrompt,
      enhanced: false,
      textModel: null,
    }))
    ltxPromptEnhanceMock.isLtx23VideoModel.mockImplementation((modelKey: string | null | undefined) => {
      const normalized = String(modelKey || '').toLowerCase()
      return normalized.includes('ltx2.3')
        || normalized.includes('ltx-2.3')
        || normalized.includes('/ltx')
        || normalized.includes('ltxv')
    })

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionVoiceLine.findUnique.mockResolvedValue({
      id: 'line-1',
      audioUrl: 'cos/line-1.mp3',
      audioDuration: 1200,
    })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue([])

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_PANEL: fails explicitly when payload.videoModel is missing', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {},
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_MODEL_REQUIRED: payload.videoModel is required')
  })

  it('VIDEO_PANEL: forwards async download headers into COS upload', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'openai-compatible:oa-1::sora-2',
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/video.mp4',
      'panel-video',
      'panel-1',
      {
        Authorization: 'Bearer oa-key',
      },
    )
  })

  it('VIDEO_PANEL: passes through actual video token usage', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      actualVideoTokens: 108000,
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
    })

    const result = await processor!(job) as { panelId: string; videoUrl: string; actualVideoTokens: number }
    expect(result).toEqual({
      panelId: 'panel-1',
      videoUrl: 'cos/lip-sync/video.mp4',
      actualVideoTokens: 108000,
    })
  })

  it('VIDEO_PANEL: uses the enhanced prompt for LTX2.3 generation', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    ltxPromptEnhanceMock.enhanceLtx23VideoPrompt.mockResolvedValueOnce({
      prompt: 'enhanced ltx prompt',
      enhanced: true,
      textModel: 'bailian::qwen3.5-plus',
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: LTX23_DEFAULT_MODEL,
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(ltxPromptEnhanceMock.enhanceLtx23VideoPrompt).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      modelKey: LTX23_DEFAULT_MODEL,
      originalPrompt: expect.stringContaining('Creator prompt intent: panel prompt'),
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          prompt: 'enhanced ltx prompt',
        }),
      }),
    )
  })

  it('VIDEO_PANEL: defaults normal LTX2.3 panels to the selected profile timing', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: LTX23_DEFAULT_MODEL,
      },
    })

    await processor!(job)

    expect(ltxPromptEnhanceMock.enhanceLtx23VideoPrompt).toHaveBeenCalledWith(expect.objectContaining({
      durationSeconds: 6,
      fps: 25,
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          duration: 6,
          fps: 25,
          generationMode: 'normal',
        }),
      }),
    )
  })

  it('VIDEO_PANEL: auto-routes default LTX2.3 long linked audio to the long-video profile', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue([
      {
        id: 'line-1',
        speaker: 'Doctor',
        content: 'We need to review every symptom carefully before giving the next instruction.',
        audioDuration: 23_700,
      },
    ])

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: LTX23_DEFAULT_MODEL,
        videoDurationBinding: {
          mode: 'match_audio',
          voiceLineIds: ['line-1'],
        },
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(ltxPromptEnhanceMock.enhanceLtx23VideoPrompt).toHaveBeenCalledWith(expect.objectContaining({
      modelKey: 'comfyui::basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'comfyui::basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
        allowCustomDuration: true,
        options: expect.objectContaining({
          duration: 23.7,
          fps: 25,
          generationMode: 'normal',
        }),
      }),
    )
  })

  it('VIDEO_PANEL: preserves exact routed LTX2.3 duration while keeping capability duration bucket in payload', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      videoPrompt: '男子突然转身奔跑，镜头跟拍推近',
      description: '男子突然转身奔跑，镜头跟拍推近',
      cameraMove: '跟拍推近',
      sceneType: 'action',
    }))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: LTX23_LARGE_MOTION_MODEL,
        ltx23WorkflowSelection: 'auto',
        ltx23WorkflowRouting: {
          selectedModelKey: LTX23_LARGE_MOTION_MODEL,
          durationSeconds: 14,
        },
        generationOptions: {
          duration: 16,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: LTX23_LARGE_MOTION_MODEL,
        allowCustomDuration: true,
        options: expect.objectContaining({
          duration: 14,
          fps: 25,
          generationMode: 'normal',
        }),
      }),
    )
  })

  it('VIDEO_PANEL: allows exact audio-driven LTX2.3 duration to bypass enum duration options downstream', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue([
      {
        id: 'line-1',
        speaker: '中年医生',
        content: '陈迹你好，我现在需要问你一些问题。',
        audioDuration: 11_430,
      },
    ])

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: LTX23_DEFAULT_MODEL,
        videoDurationBinding: {
          mode: 'match_audio',
          voiceLineIds: ['line-1'],
        },
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowCustomDuration: true,
        options: expect.objectContaining({
          duration: 11.43,
          fps: 25,
          generationMode: 'normal',
        }),
      }),
    )
  })

  it('VIDEO_PANEL: sends long linked audio to selected long-video workflow without split segments', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue([
      {
        id: 'line-1',
        speaker: 'Doctor',
        content: 'We need to review every symptom carefully before giving the next instruction.',
        audioDuration: 23_700,
      },
    ])

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
        videoDurationBinding: {
          mode: 'match_audio',
          voiceLineIds: ['line-1'],
        },
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    const result = await processor!(job) as { panelId: string; videoUrl: string }

    expect(result).toEqual({
      panelId: 'panel-1',
      videoUrl: 'cos/lip-sync/video.mp4',
    })
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        imageUrl: 'https://signed.example/cos/panel-image.png',
        allowCustomDuration: true,
        options: expect.objectContaining({
          duration: 23.7,
          fps: 25,
          generationMode: 'normal',
        }),
      }),
    )
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        videoUrl: 'cos/lip-sync/video.mp4',
        videoGenerationMode: 'normal',
      }),
    })
  })

  it('VIDEO_PANEL: ignores stale structured multi-shot prompts when saved prompt was not user edited', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const staleMultiShotPrompt = [
      'GLOBAL:',
      'Office night, two doctors talking, cinematic fixed camera.',
      '',
      'LOCAL:',
      '[0.0-2.5] The middle-aged doctor listens carefully | [2.5-5.0] The young doctor raises his hand and pushes glasses',
    ].join('\n')

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      videoPrompt: staleMultiShotPrompt,
      videoPromptEditedByUser: false,
      description: 'The middle-aged doctor raises his right hand and pushes his glasses.',
      srtSegment: 'The middle-aged doctor pushes his glasses.',
    }))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: LTX23_DEFAULT_MODEL,
      },
    })

    await processor!(job)

    const enhancementInput = ltxPromptEnhanceMock.enhanceLtx23VideoPrompt.mock.calls[0]?.[0] as {
      originalPrompt: string
    }
    expect(enhancementInput.originalPrompt).toContain(
      'Current shot action: The middle-aged doctor raises his right hand and pushes his glasses.',
    )
    expect(enhancementInput.originalPrompt).toContain(
      'Creator prompt intent: The middle-aged doctor raises his right hand and pushes his glasses.',
    )
    expect(enhancementInput.originalPrompt).not.toContain('GLOBAL:')
    expect(enhancementInput.originalPrompt).not.toContain('[0.0-2.5]')
  })

  it('VIDEO_PANEL: skips LTX enhancement when the saved prompt is user edited', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(buildPanel({
      videoPrompt: '涓や汉鐩稿鑰屽潗锛屼笉瑕佸嚭鐜颁换浣曠壒鏁?',
      videoPromptEditedByUser: true,
    }))

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: LTX23_DEFAULT_MODEL,
      },
    })

    await processor!(job)

    expect(ltxPromptEnhanceMock.enhanceLtx23VideoPrompt).toHaveBeenCalledWith(expect.objectContaining({
      originalPrompt: expect.stringContaining('涓や汉鐩稿鑰屽潗锛屼笉瑕佸嚭鐜颁换浣曠壒鏁?'),
      userEdited: true,
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          prompt: expect.stringContaining('涓や汉鐩稿鑰屽潗锛屼笉瑕佸嚭鐜颁换浣曠壒鏁?'),
        }),
      }),
    )
  })

  it('VIDEO_PANEL: ignores empty first-last custom prompt and persists a default bridge prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const firstPanel = buildPanel({
      videoPrompt: 'wide office shot with the doctor and Chen Ji sitting across the desk',
      firstLastFramePrompt: null,
    })
    const lastPanel = buildPanel({
      id: 'panel-2',
      panelIndex: 1,
      imageUrl: 'cos/last-frame.png',
      videoPrompt: 'doctor raises one hand and pushes his glasses',
      description: 'doctor pushes his glasses',
    })
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(firstPanel)
    prismaMock.novelPromotionPanel.findFirst.mockImplementation(async (args: { where?: { panelIndex?: number } }) => {
      if (args.where?.panelIndex === 1) return lastPanel
      return null
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: LTX23_FIRST_LAST_MODEL,
        firstLastFrame: {
          flModel: LTX23_FIRST_LAST_MODEL,
          lastFrameStoryboardId: 'storyboard-1',
          lastFramePanelIndex: 1,
          customPrompt: '',
        },
        generationOptions: {
          duration: 4,
          generationMode: 'firstlastframe',
        },
      },
    })

    await processor!(job)

    expect(ltxPromptEnhanceMock.enhanceLtx23VideoPrompt).toHaveBeenCalledWith(expect.objectContaining({
      originalPrompt: expect.stringContaining('Bridge naturally into the last frame: doctor raises one hand and pushes his glasses'),
      generationMode: 'firstlastframe',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          generationMode: 'firstlastframe',
          lastFrameImageUrl: 'https://signed.example/cos/last-frame.png',
        }),
      }),
    )
    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: expect.objectContaining({
        firstLastFramePrompt: expect.stringContaining('Bridge naturally into the last frame'),
        videoGenerationMode: 'firstlastframe',
      }),
    })
  })

  it('LIP_SYNC: fails explicitly when panel is missing', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(null)
    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: { voiceLineId: 'line-1' },
      targetId: 'panel-missing',
    })

    await expect(processor!(job)).rejects.toThrow('Lip-sync panel not found')
  })

  it('LIP_SYNC: writes back lipSyncVideoUrl and clears lipSyncTaskId', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: {
        voiceLineId: 'line-1',
        lipSyncModel: 'fal::lipsync-model',
      },
      targetId: 'panel-1',
    })

    const result = await processor!(job) as { panelId: string; voiceLineId: string; lipSyncVideoUrl: string }
    expect(result).toEqual({
      panelId: 'panel-1',
      voiceLineId: 'line-1',
      lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
    })

    expect(utilsMock.resolveLipSyncVideoSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        modelKey: 'fal::lipsync-model',
        audioDurationMs: 1200,
        videoDurationMs: 5000,
      }),
    )

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
        lipSyncTaskId: null,
      },
    })
  })

  it('throws explicitly for unsupported task types', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const unsupportedJob = buildJob({
      type: TASK_TYPE.AI_CREATE_CHARACTER,
    })

    await expect(processor!(unsupportedJob)).rejects.toThrow('Unsupported video task type')
  })
})
