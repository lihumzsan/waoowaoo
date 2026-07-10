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
        message: 'INVALID_PARAMS',
        issues: expect.any(Array),
      }),
    })
  })
})
