import {
  FORCE_DYNAMIC_ASSET_HUB_ROUTES,
  NextResponse,
  ROUTE_CASES,
  authState,
  beforeEach,
  describe,
  expect,
  invokePostRoute,
  it,
  maybeSubmitLLMTaskMock,
  toModuleImportPath,
  vi,
} from './llm-observe-routes.fixture'

describe('api contract - llm observe routes (behavior)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    maybeSubmitLLMTaskMock.mockResolvedValue(
      NextResponse.json({
        success: true,
        async: true,
        taskId: 'task-1',
        runId: null,
        status: 'queued',
        deduped: false,
      }),
    )
  })

  it('keeps expected coverage size', () => {
    expect(ROUTE_CASES.length).toBe(12)
  })

  it('marks asset-hub AI routes as force-dynamic to keep app-route build registration stable', async () => {
    for (const routeFile of FORCE_DYNAMIC_ASSET_HUB_ROUTES) {
      const mod = await import(toModuleImportPath(routeFile)) as { dynamic?: string }
      expect(mod.dynamic).toBe('force-dynamic')
    }
  })

  for (const routeCase of ROUTE_CASES) {
    it(`${routeCase.routeFile} -> returns 401 when unauthenticated`, async () => {
      authState.authenticated = false
      const res = await invokePostRoute(routeCase)
      expect(res.status).toBe(401)
      expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
    })

    it(`${routeCase.routeFile} -> submits llm task with expected contract when authenticated`, async () => {
      const res = await invokePostRoute(routeCase)
      expect(res.status).toBe(200)
      expect(maybeSubmitLLMTaskMock).toHaveBeenCalledWith(expect.objectContaining({
        type: routeCase.expectedTaskType,
        targetType: routeCase.expectedTargetType,
        projectId: routeCase.expectedProjectId,
        userId: 'user-1',
      }))

      const callArg = maybeSubmitLLMTaskMock.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
      expect(callArg?.type).toBe(routeCase.expectedTaskType)
      expect(callArg?.targetType).toBe(routeCase.expectedTargetType)
      expect(callArg?.projectId).toBe(routeCase.expectedProjectId)
      expect(callArg?.userId).toBe('user-1')

      const json = await res.json() as Record<string, unknown>
      expect(json.async).toBe(true)
      expect(typeof json.taskId).toBe('string')
    })
  }
})
