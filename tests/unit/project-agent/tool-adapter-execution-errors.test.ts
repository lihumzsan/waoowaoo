import {
  ApiError,
  EFFECTS_NONE,
  TASK_TYPE,
  afterEach,
  beforeEach,
  buildRequest,
  buildWriter,
  describe,
  executeProjectAgentOperationFromTool,
  expect,
  it,
  makeTestOperation,
  originalBillingMode,
  originalDeploymentEdition,
  registryState,
  vi,
  z,
  type OperationPlan,
} from './tool-adapter.fixture'

describe('executeProjectAgentOperationFromTool', () => {
  beforeEach(() => {
    registryState.registry = {}
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (originalDeploymentEdition === undefined) {
      delete process.env.DEPLOYMENT_EDITION
    } else {
      process.env.DEPLOYMENT_EDITION = originalDeploymentEdition
    }
    if (originalBillingMode === undefined) {
      delete process.env.BILLING_MODE
    } else {
      process.env.BILLING_MODE = originalBillingMode
    }
  })

  it('[execution error] -> returns structured error', async () => {
    registryState.registry = {
      fail_op: makeTestOperation({
        id: 'fail_op',
        summary: 'fail',
        intent: 'act',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw new Error('boom')
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'fail_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('OPERATION_EXECUTION_FAILED')
    expect(result.error.message).toBe('boom')
  })

  it('[execution ApiError] -> preserves structured details for the model', async () => {
    registryState.registry = {
      forbidden_op: makeTestOperation({
        id: 'forbidden_op',
        summary: 'forbidden',
        intent: 'act',
        effects: EFFECTS_NONE,
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

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'forbidden_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('OPERATION_EXECUTION_FAILED')
    expect(result.error.message).toBe('video model is managed by system configuration')
    expect(result.error.details).toEqual(expect.objectContaining({
      apiErrorCode: 'FORBIDDEN',
      httpStatus: 403,
      code: 'TASK_MODEL_MANAGED_BY_CONFIG',
      reasonCode: 'TASK_MODEL_MANAGED_BY_CONFIG',
      field: 'videoModel',
      message: 'video model is managed by system configuration',
    }))
  })
})
