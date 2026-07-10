import {
  apiAdapterMock,
  authState,
  beforeEach,
  buildMockRequest,
  describe,
  expect,
  it,
  regeneratePanelImagePost,
  vi,
} from './project-media-routes.fixture'

describe('api contract - project media generation routes (operation adapter)', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/regenerate-panel-image -> forwards reference image usage notes', async () => {
    apiAdapterMock.executeProjectAgentOperationFromApi.mockResolvedValueOnce({ success: true })

    const res = await regeneratePanelImagePost(
      buildMockRequest({
        path: '/api/projects/project-1/regenerate-panel-image',
        method: 'POST',
        body: {
          panelId: 'panel-1',
          confirmed: true,
          confirmedMaxCost: 2.5,
          referenceMode: 'storyboard',
          referencePanelIds: ['panel-previous'],
          extraImageUrls: ['https://example.com/asset-ref.png'],
          referenceImageNotes: [
            {
              source: 'storyboard',
              referencePanelId: 'panel-previous',
              label: 'previous panel',
              instruction: 'Use for continuity',
            },
            {
              source: 'character',
              url: 'https://example.com/asset-ref.png',
              label: 'hero asset',
              instruction: 'Use for identity',
            },
          ],
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(200)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'regenerate_panel_image',
      input: expect.objectContaining({
        panelId: 'panel-1',
        confirmed: true,
        confirmedMaxCost: 2.5,
        referenceMode: 'storyboard',
        referencePanelIds: ['panel-previous'],
        extraImageUrls: ['https://example.com/asset-ref.png'],
        referenceImageNotes: [
          {
            source: 'storyboard',
            referencePanelId: 'panel-previous',
            label: 'previous panel',
            instruction: 'Use for continuity',
          },
          {
            source: 'character',
            url: 'https://example.com/asset-ref.png',
            label: 'hero asset',
            instruction: 'Use for identity',
          },
        ],
      }),
    }))
  })

  it('POST /api/projects/[projectId]/regenerate-panel-image -> rejects invalid reference mode', async () => {
    const res = await regeneratePanelImagePost(
      buildMockRequest({
        path: '/api/projects/project-1/regenerate-panel-image',
        method: 'POST',
        body: {
          panelId: 'panel-1',
          referenceMode: 'legacy',
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1' }) },
    )

    expect(res.status).toBe(400)
    expect(apiAdapterMock.executeProjectAgentOperationFromApi).not.toHaveBeenCalled()
  })
})
