import {
  authState,
  beforeEach,
  buildMockRequest,
  describe,
  expect,
  it,
  operationPlanPost,
  planningMock,
  vi,
} from './project-media-routes.fixture'

describe('api contract - project media generation routes (operation adapter)', () => {
  beforeEach(() => {
    authState.authenticated = true
    vi.clearAllMocks()
  })

  it('POST /api/projects/[projectId]/operations/[operationId]/plan -> delegates to the planning runtime', async () => {
    planningMock.planProjectAgentOperationFromApi.mockResolvedValueOnce({
      operationId: 'regenerate_panel_image',
      kind: 'task_submission',
      taskCount: 1,
      quote: {
        showCredits: true,
        billingMode: 'ENFORCE',
        billable: true,
        taskCount: 1,
        mediaTaskCount: 1,
        totalMaxFrozenCost: 3,
        currency: 'credits',
        items: [],
      },
      tasks: [],
    })

    const res = await operationPlanPost(
      buildMockRequest({
        path: '/api/projects/project-1/operations/regenerate_panel_image/plan',
        method: 'POST',
        body: {
          input: { panelId: 'panel-1' },
          context: {
            locale: 'zh',
            episodeId: 'episode-1',
            selectedPanelId: 'panel-1',
          },
        },
      }),
      { params: Promise.resolve({ projectId: 'project-1', operationId: 'regenerate_panel_image' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.quote.totalMaxFrozenCost).toBe(3)
    expect(planningMock.planProjectAgentOperationFromApi).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'regenerate_panel_image',
      projectId: 'project-1',
      userId: 'user-1',
      input: { panelId: 'panel-1' },
      source: 'project-ui',
      context: {
        locale: 'zh',
        episodeId: 'episode-1',
        selectedScopeRef: null,
        selectedPanelId: 'panel-1',
        selectedAssetId: null,
      },
    }))
  })
})
