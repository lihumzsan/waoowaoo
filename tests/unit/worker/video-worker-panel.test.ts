import {
  TASK_TYPE,
  beforeEach,
  buildCorePlan,
  buildJob,
  buildPanel,
  buildStoryboardSourceResult,
  describe,
  expect,
  it,
  prismaMock,
  storyboardSourceMock,
  utilsMock,
  vi,
  workerState,
} from './video-worker.fixture'

describe('worker video processor behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null

    prismaMock.projectPanel.findUnique.mockResolvedValue(buildPanel())
    prismaMock.projectPanel.findFirst.mockResolvedValue(buildPanel())
    prismaMock.project.findUnique.mockResolvedValue({
      analysisModel: 'openai::gpt-4.1',
      videoRatio: '9:16',
      artStyle: 'cinematic',
    })
    const defaultCorePlan = buildCorePlan()
    prismaMock.projectEditScript.findFirst.mockResolvedValue({
      id: 'edit-script-1',
      corePlanJson: defaultCorePlan,
    })
    prismaMock.projectVideoGroup.findUnique.mockResolvedValue({
      prompt: 'composed video group prompt',
    })
    prismaMock.projectEditBible.findFirst.mockResolvedValue(null)
    storyboardSourceMock.buildStoryboardConsistencySource.mockResolvedValue(buildStoryboardSourceResult(defaultCorePlan))

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_PANEL: 缺少 payload.videoModel 时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {},
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_MODEL_REQUIRED: payload.videoModel is required')
  })

  it('VIDEO_PANEL: 透传异步轮询返回的下载头到 COS 上传', async () => {
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
        videoModel: 'fal::veo3/fast',
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
      {
        taskId: job.data.taskId,
        artifact: 'panel-video:panel-1',
      },
    )
  })

  it('VIDEO_PANEL: uses the persisted panel video prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          prompt: expect.stringContaining('panel video prompt'),
        }),
      }),
    )
  })

  it('VIDEO_PANEL: 将 Ark 返回的实际视频 token 用量透传到任务结果', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      actualVideoTokens: 108000,
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 5,
          resolution: '720p',
        },
      },
    })

    const result = await processor!(job) as { panelId: string; videoUrl: string; actualVideoTokens: number }
    expect(result).toEqual({
      panelId: 'panel-1',
      videoUrl: 'cos/video/video.mp4',
      actualVideoTokens: 108000,
    })
  })

  it('VIDEO_PANEL: 成功生成后保存本次实际使用的 generationOptions', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 8,
          resolution: '720p',
          generateAudio: true,
          aspectRatio: '9:16',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          aspectRatio: '16:9',
          duration: 5,
          resolution: '720p',
          generateAudio: true,
          generationMode: 'normal',
        }),
      }),
    )
    expect(prismaMock.projectPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        videoUrl: 'cos/video/video.mp4',
        lastVideoGenerationOptions: {
          resolution: '720p',
          generateAudio: true,
        },
      },
    })
  })

  it('VIDEO_PANEL: 缺少系统镜头时长时显式失败', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectPanel.findUnique.mockResolvedValueOnce(buildPanel({ duration: null }))
    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_PANEL_DURATION_REQUIRED:panel-1')
  })
})
