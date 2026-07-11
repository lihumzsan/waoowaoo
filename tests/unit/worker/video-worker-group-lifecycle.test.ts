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
  videoGroupMocks,
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

  it('VIDEO_GROUP: passes storyboard images individually in shot order and writes ProjectVideoGroup output', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      { ...buildPanel({ id: 'panel-1', sourceShotId: 'shot-1' }), panelNumber: 1, imageMedia: { storageKey: 'images/panel-1.png' } },
      { ...buildPanel({ id: 'panel-2', sourceShotId: 'shot-2' }), panelNumber: 2, imageMedia: { storageKey: 'images/panel-2.png' } },
      { ...buildPanel({ id: 'panel-3', sourceShotId: 'shot-3' }), panelNumber: 3, imageMedia: { storageKey: 'images/panel-3.png' } },
      { ...buildPanel({ id: 'panel-4', sourceShotId: 'shot-4' }), panelNumber: 4, imageMedia: { storageKey: 'images/panel-4.png' } },
    ])
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('group-video/group-1.mp4')

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 14,
      shotNumbers: [1, 2, 3, 4],
    }))
    expect(videoGroupMocks.composeAndStoreGridReferenceImage).not.toHaveBeenCalled()
    expect(videoGroupMocks.executeAiTextStep).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'google::veo',
      referenceImages: [
        { url: 'images/panel-1.png', role: 'reference', order: 1, source: 'storyboard' },
        { url: 'images/panel-2.png', role: 'reference', order: 2, source: 'storyboard' },
        { url: 'images/panel-3.png', role: 'reference', order: 3, source: 'storyboard' },
        { url: 'images/panel-4.png', role: 'reference', order: 4, source: 'storyboard' },
      ],
      options: expect.objectContaining({
        prompt: 'composed video group prompt',
        duration: 14,
        aspectRatio: '9:16',
      }),
    }))
    expect(prismaMock.projectVideoGroup.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'group-1', taskId: 'task-1' }),
      data: expect.objectContaining({
        status: 'completed',
        videoUrl: '/m/video-public-1',
        videoMediaId: 'video-media-1',
      }),
    }))
    expect(prismaMock.projectVideoGroup.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'group-1', taskId: 'task-1' }),
      data: expect.objectContaining({
        referenceImageUrl: null,
        referenceImageMediaId: null,
      }),
    }))
  })

  it('VIDEO_GROUP: does not finalize the target when an attempt fails before retry policy runs', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({ prompt: null })

    await expect(processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
      },
    }))).rejects.toThrow('VIDEO_GROUP_PROMPT_MISSING:group-1')

    expect(utilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
    expect(prismaMock.projectVideoGroup.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'group-1' },
      data: expect.objectContaining({
        status: 'failed',
      }),
    }))
  })

  it('VIDEO_GROUP: uses stored prompt without reading generation segment facts', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const twoShotCorePlan = buildCorePlan([
      { shotNumber: 1, durationSec: 2, action: 'Shot one', sound: 'tone' },
      { shotNumber: 2, durationSec: 3, action: 'Shot two', sound: 'pulse' },
    ], [
      { shotIds: ['shot-1'], continuity: 'shot one only' },
      { shotIds: ['shot-2'], continuity: 'shot two only' },
    ])
    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      id: 'edit-script-1',
      corePlanJson: twoShotCorePlan,
    })
    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      { ...buildPanel({ id: 'panel-1', sourceShotId: 'shot-1' }), panelNumber: 1, imageMedia: { storageKey: 'images/panel-1.png' } },
      { ...buildPanel({ id: 'panel-2', sourceShotId: 'shot-2' }), panelNumber: 2, imageMedia: { storageKey: 'images/panel-2.png' } },
    ])
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'stored segment prompt for unmatched generation segment',
    })
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('group-video/group-1.mp4')

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
      },
    }))

    expect(storyboardSourceMock.buildStoryboardConsistencySource).not.toHaveBeenCalled()
    expect(videoGroupMocks.executeAiTextStep).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: 'stored segment prompt for unmatched generation segment',
      }),
    }))
  })

  it('VIDEO_GROUP: replays a persisted success without invoking the provider again', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()
    prismaMock.projectVideoGroup.findFirst.mockResolvedValueOnce({
      id: 'group-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      referenceImageUrl: null,
      durationSec: 14,
      shotIds: ['shot-1', 'shot-2'],
      shotNumbers: [1, 2],
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: {
        videoModel: 'google::veo',
        gridMode: '2x2',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
      },
    }))

    expect(result).toMatchObject({ groupId: 'group-1', videoMediaId: 'video-media-1' })
    expect(utilsMock.resolveVideoSourceFromGeneration).not.toHaveBeenCalled()
    expect(prismaMock.projectVideoGroup.updateMany).not.toHaveBeenCalled()
  })

  it('未知任务类型: 显式报错', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const unsupportedJob = buildJob({
      type: TASK_TYPE.AI_CREATE_CHARACTER,
    })

    await expect(processor!(unsupportedJob)).rejects.toThrow('TASK_QUEUE_MISMATCH:ai_create_character:text:video')
  })
})
