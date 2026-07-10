import {
  apiAdapterMock,
  authState,
  beforeEach,
  buildMockRequest,
  describe,
  expect,
  generateVideoPost,
  it,
  vi,
} from './project-media-routes.fixture'

describe('api contract - project media generation routes (operation adapter)', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/generate-video -> routes single/batch to explicit operations', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true })

    const singleRes = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: { panelId: 'panel-1' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    const batchRes = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: { episodeId: 'episode-1', all: true },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    const gridSingleRes = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: {
          episodeId: 'episode-1',
          mode: 'grid',
          gridMode: '2x2',
          shotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    const gridBatchRes = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: {
          episodeId: 'episode-1',
          mode: 'grid',
          gridMode: '3x3',
          all: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    const autoBatchRes = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: {
          episodeId: 'episode-1',
          mode: 'auto',
          all: true,
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    const assetReferenceSingleRes = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: {
          episodeId: 'episode-1',
          mode: 'asset-reference',
          segmentIndex: 0,
          referenceImageUrls: ['https://example.com/character.png'],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    const assetReferenceBatchRes = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: {
          episodeId: 'episode-1',
          mode: 'asset-reference',
          all: true,
          referenceImageUrls: ['https://example.com/character.png'],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(singleRes.status).toBe(200)
    expect(batchRes.status).toBe(200)
    expect(gridSingleRes.status).toBe(200)
    expect(gridBatchRes.status).toBe(200)
    expect(autoBatchRes.status).toBe(200)
    expect(assetReferenceSingleRes.status).toBe(200)
    expect(assetReferenceBatchRes.status).toBe(200)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenNthCalledWith(1, expect.objectContaining({
      operationId: 'generate_panel_video',
    }))
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenNthCalledWith(2, expect.objectContaining({
      operationId: 'generate_episode_videos',
    }))
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenNthCalledWith(3, expect.objectContaining({
      operationId: 'generate_video_group',
      input: expect.objectContaining({
        gridMode: '2x2',
        shotIds: ['shot-1', 'shot-2', 'shot-3', 'shot-4'],
      }),
    }))
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenNthCalledWith(4, expect.objectContaining({
      operationId: 'generate_episode_video_groups',
      input: expect.objectContaining({
        gridMode: '3x3',
      }),
    }))
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenNthCalledWith(5, expect.objectContaining({
      operationId: 'generate_episode_videos_auto',
      input: expect.objectContaining({
        mode: 'auto',
      }),
    }))
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenNthCalledWith(6, expect.objectContaining({
      operationId: 'generate_asset_reference_video',
      input: expect.objectContaining({
        mode: 'asset-reference',
        segmentIndex: 0,
        referenceImageUrls: ['https://example.com/character.png'],
      }),
    }))
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenNthCalledWith(7, expect.objectContaining({
      operationId: 'generate_episode_asset_reference_videos',
      input: expect.objectContaining({
        mode: 'asset-reference',
        referenceImageUrls: ['https://example.com/character.png'],
      }),
    }))
  })

  it('POST /api/projects/[projectId]/generate-video -> rejects request-supplied video model before submitting an operation', async () => {
    const response = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: { panelId: 'panel-1', videoModel: 'provider/model' },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toMatchObject({
      code: 'FORBIDDEN',
      details: {
        code: 'TASK_MODEL_MANAGED_BY_CONFIG',
        field: 'videoModel',
      },
    })
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).not.toHaveBeenCalled()
  })

  it('POST /api/projects/[projectId]/generate-video -> rejects legacy asset-reference blockIndex without submitting an operation', async () => {
    const response = await generateVideoPost(
      buildMockRequest({
        path: '/api/projects/project-1/generate-video',
        method: 'POST',
        body: {
          episodeId: 'episode-1',
          mode: 'asset-reference',
          blockIndex: 0,
          referenceImageUrls: ['https://example.com/character.png'],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toMatchObject({
      code: 'INVALID_PARAMS',
      details: {
        code: 'ASSET_REFERENCE_VIDEO_SEGMENT_REQUIRED',
        field: 'segmentIndex',
      },
    })
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).not.toHaveBeenCalled()
  })
})
