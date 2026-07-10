import {
  apiAdapterMock,
  authState,
  beforeEach,
  buildMockRequest,
  describe,
  expect,
  finalVideoRenderPost,
  it,
  vi,
} from './project-media-routes.fixture'

describe('api contract - project media generation routes (operation adapter)', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/final-video-render -> routes to final render operation with confirmation', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValueOnce({ success: true })

    const res = await finalVideoRenderPost(
      buildMockRequest({
        path: '/api/projects/project-1/final-video-render',
        method: 'POST',
        body: { episodeId: 'episode-1', confirmed: true, bgmVolume: 0.35 },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'render_final_video',
      projectId: 'project-1',
      userId: 'user-1',
      context: { episodeId: 'episode-1' },
      input: {
        confirmed: true,
        episodeId: 'episode-1',
        bgmVolume: 0.35,
      },
      source: 'project-ui',
    }))
  })
})
