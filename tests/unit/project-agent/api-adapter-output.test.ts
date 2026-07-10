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

  it('[output schema mismatch] -> throws ApiError EXTERNAL_ERROR with output-invalid code', async () => {
    registryState.registry = {
      output_guard_op: makeTestOperation({
        id: 'output_guard_op',
        summary: 'output guard',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ value: 'unexpected-shape' } as unknown as { ok: boolean })),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'output_guard_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      details: expect.objectContaining({
        code: 'OPERATION_OUTPUT_INVALID',
        message: 'operation output schema mismatch: output_guard_op',
      }),
    })
  })

  it('[execution throws not found-like message] -> infers ApiError NOT_FOUND', async () => {
    registryState.registry = {
      infer_not_found_op: makeTestOperation({
        id: 'infer_not_found_op',
        summary: 'infer not found',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw new Error('resource not found')
        }),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'infer_not_found_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: expect.objectContaining({
        message: 'resource not found',
      }),
    })
  })
})
