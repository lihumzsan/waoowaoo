import {
  ApiError,
  EFFECTS_WRITE,
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

  it('[execution throws undefined] -> throws ApiError EXTERNAL_ERROR with fallback message', async () => {
    registryState.registry = {
      fail_undefined: makeTestOperation({
        id: 'fail_undefined',
        summary: 'fail undefined',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw undefined
        }),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'fail_undefined',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      details: expect.objectContaining({
        code: 'OPERATION_EXECUTION_FAILED',
        message: 'OPERATION_FAILED',
      }),
    })
  })

  it('[execution throws ApiError] -> preserves structured operation details', async () => {
    registryState.registry = {
      api_forbidden_op: makeTestOperation({
        id: 'api_forbidden_op',
        summary: 'api forbidden',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw new ApiError('FORBIDDEN', {
            code: 'TASK_MODEL_MANAGED_BY_CONFIG',
            field: 'videoModel',
            message: 'video model is managed by system configuration',
          })
        }),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'api_forbidden_op',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: expect.objectContaining({
        code: 'TASK_MODEL_MANAGED_BY_CONFIG',
        field: 'videoModel',
        message: 'video model is managed by system configuration',
      }),
    })
  })

  it('[execution throws prisma missing column] -> throws ApiError EXTERNAL_ERROR with schema-mismatch code', async () => {
    registryState.registry = {
      prisma_schema_mismatch: makeTestOperation({
        id: 'prisma_schema_mismatch',
        summary: 'prisma schema mismatch',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw {
            code: 'P2022',
            meta: {
              column: 'visualStylePresetId',
            },
          }
        }),
      }),
    }

    const promise = executeProjectAgentOperationFromApi({
      request: buildRequest(),
      operationId: 'prisma_schema_mismatch',
      projectId: 'project-1',
      userId: 'user-1',
      input: {},
      source: 'project-ui',
    })

    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toMatchObject({
      code: 'EXTERNAL_ERROR',
      details: expect.objectContaining({
        code: 'DATABASE_SCHEMA_MISMATCH',
        field: 'visualStylePresetId',
        message: 'database schema mismatch: missing column visualStylePresetId; run the latest Prisma migration before starting the app',
      }),
    })
  })
})
