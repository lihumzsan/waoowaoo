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

  it('VIDEO_GROUP asset_reference: allows Fal Happy Horse multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-happy-horse.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'happy horse asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-happy-horse-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::alibaba/happy-horse/image-to-video',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
        prompt: 'happy horse asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-happy-horse-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::alibaba/happy-horse/image-to-video',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('happy horse asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: allows Fal Seedance 2.0 Fast multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-seedance-fast.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'seedance fast asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-seedance-fast-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::bytedance/seedance-2.0/fast',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
        prompt: 'seedance fast asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: { resolution: '720p' },
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-seedance-fast-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::bytedance/seedance-2.0/fast',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('seedance fast asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: allows Fal Kling v3 multi-reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-kling-v3.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'kling v3 asset reference block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-kling-v3-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::fal-ai/kling-video/v3/pro/image-to-video',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
        prompt: 'kling v3 asset reference block prompt',
        referenceImageUrls: ['https://example.com/hero.png', 'https://example.com/location.png'],
        generationOptions: {},
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-kling-v3-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::fal-ai/kling-video/v3/pro/image-to-video',
      referenceImages: [
        { url: 'https://example.com/hero.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/location.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('kling v3 asset reference block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })

  it('VIDEO_GROUP asset_reference: allows Fal Kling O3 two-frame reference assets', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.uploadVideoSourceToCos.mockResolvedValueOnce('asset-reference-video/group-kling-o3.mp4')
    prismaMock.projectVideoGroup.findUnique.mockResolvedValueOnce({
      prompt: 'kling o3 two-frame block prompt',
    })

    const result = await processor!(buildJob({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-kling-o3-1',
      payload: {
        sourceMode: 'asset_reference',
        videoModel: 'fal::fal-ai/kling-video/o3/standard/image-to-video',
        episodeId: 'episode-1',
        chapterId: 'chapter-1',
        shotIds: ['shot-1', 'shot-2'],
        prompt: 'kling o3 two-frame block prompt',
        referenceImageUrls: ['https://example.com/start.png', 'https://example.com/end.png'],
        generationOptions: {},
      },
    }))

    expect(result).toEqual(expect.objectContaining({
      groupId: 'group-kling-o3-1',
      videoUrl: '/m/video-public-1',
      videoMediaId: 'video-media-1',
      durationSec: 5,
      shotNumbers: [1, 2],
      sourceMode: 'asset_reference',
    }))
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      modelId: 'fal::fal-ai/kling-video/o3/standard/image-to-video',
      referenceImages: [
        { url: 'https://example.com/start.png', role: 'reference', order: 1, source: 'asset' },
        { url: 'https://example.com/end.png', role: 'reference', order: 2, source: 'asset' },
      ],
      options: expect.objectContaining({
        prompt: expect.stringContaining('kling o3 two-frame block prompt'),
        duration: 5,
        aspectRatio: '9:16',
      }),
    }))
  })
})
