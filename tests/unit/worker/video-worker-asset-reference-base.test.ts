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

  it('VIDEO_GROUP asset_reference: uses reference assets and skips storyboard grid composition', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-asset.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-asset-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'ark::doubao-seedance-2-0-260128',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
        prompt: 'asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-asset-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(videoGroupMocks.composeAndStoreGridReferenceImage).not.toHaveBeenCalled()
    expect(prismaMock.projectPanel.findMany).not.toHaveBeenCalled()
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'ark::doubao-seedance-2-0-260128',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
    expect(prismaMock.projectVideoGroup.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'group-asset-1' },
      data: expect.objectContaining({
        status: 'processing',
        referenceImageUrl: 'https://example.com/hero.png',
        referenceImageMediaId: null,
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: uses stored group prompt without building a source prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const twoShotCorePlan = buildCorePlan([
      { shotNumber: 1, durationSec: 2, action: 'Shot one', sound: 'tone' },
      { shotNumber: 2, durationSec: 3, action: 'Shot two', sound: 'pulse' },
    ])
    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce({
      id: 'edit-script-1',
      corePlanJson: twoShotCorePlan,
    })
    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-asset.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'stored asset reference block prompt',
    })

    await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-asset-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'ark::doubao-seedance-2-0-260128',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
        prompt: 'ignored payload prompt',
        referenceImageUrls: ['https://example.com/hero.png'],
      },
    }))

    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: expect.stringContaining('Use the provided reference asset image(s) as fixed visual references'),
      }),
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      options: expect.objectContaining({
        prompt: expect.stringContaining('stored asset reference block prompt'),
      }),
    }))
    expect(storyboardSourceMock.buildStoryboardConsistencySource).not.toHaveBeenCalled()
  })

  it('VIDEO_GROUP asset_reference: allows Fal Seedance 2.0 multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-seedance.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'seedance asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-seedance-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::bytedance/seedance-2.0',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
        prompt: 'seedance asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-seedance-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::bytedance/seedance-2.0',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('seedance asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })
})
