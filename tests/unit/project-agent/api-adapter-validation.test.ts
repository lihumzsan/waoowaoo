import {
  ApiError,
  EFFECTS_NONE,
  beforeEach,
  buildRequest,
  describe,
  executeProjectAgentOperationFromApi,
  expect,
  it,
  makeTestOperation,
  registryState,
  vi,
  z,
} from './api-adapter.fixture'

describe('executeProjectAgentOperationFromApi', () => {
  beforeEach(() => {
    registryState.registry = {}
    vi.clearAllMocks()
  })

  it('[operation not found] -> throws ApiError NOT_FOUND with operation id', async () => {
    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'missing_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: expect.objectContaining({
        message: 'operation not found: missing_op',
      }),
    })
  })

  it('[input schema mismatch] -> throws ApiError INVALID_PARAMS with zod issues', async () => {
    registryState.registry = {
      input_guard_op: makeTestOperation({
        id: 'input_guard_op',
        summary: 'input guard',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({ projectId: z.string().min(1) }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ ok: true })),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'input_guard_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'OPERATION_INPUT_INVALID',
        message: 'PROJECT_AGENT_INVALID_OPERATION_INPUT',
        issues: expect.any(Array),
      }),
    })
  })

  it('[tool-only operation through API] -> rejects before input parsing or execution', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      tool_only_op: makeTestOperation({
        id: 'tool_only_op',
        channels: { tool: true, api: false },
        effects: EFFECTS_NONE,
        inputSchema: z.object({ requiredValue: z.string() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'tool_only_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: expect.objectContaining({
        code: 'OPERATION_NOT_ALLOWED',
        channel: 'api',
      }),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('[API prerequisite episodeId required] -> uses the same prerequisite gate and does not execute', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      needs_episode: makeTestOperation({
        id: 'needs_episode',
        prerequisites: { episodeId: 'required' },
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'needs_episode',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'OPERATION_PREREQUISITE_MISSING',
        prerequisite: 'episodeId',
      }),
    })
    expect(execute).not.toHaveBeenCalled()
  })
})
