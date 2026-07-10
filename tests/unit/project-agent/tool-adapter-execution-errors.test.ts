import {
  ApiError,
  EFFECTS_WRITE,
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

  it('[planned media mislabeled as non-approval] -> writes the quote and refuses an unconfirmed commit', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.BILLING_MODE = 'ENFORCE'
    const writer = buildWriter()
    const plan: OperationPlan = {
      kind: 'task_submission',
      operationId: 'music_preview_op',
      projectId: 'project-1',
      userId: 'user-1',
      tasks: [{
        id: 'music-task-1',
        taskType: TASK_TYPE.MUSIC_GENERATE,
        target: {
          targetType: 'Project',
          targetId: 'project-1',
        },
        payload: {
          prompt: 'quiet cue',
          durationSeconds: 30,
        },
        billingInfo: {
          billable: true,
          source: 'task',
          taskType: TASK_TYPE.MUSIC_GENERATE,
          apiType: 'music',
          model: 'music-model',
          quantity: 1,
          unit: 'call',
          maxFrozenCost: 2.5,
          action: TASK_TYPE.MUSIC_GENERATE,
          status: 'quoted',
        },
        locale: 'zh',
      }],
    }
    const planMock = vi.fn(async () => plan)
    const commitMock = vi.fn(async () => ({ ok: true, taskCount: plan.tasks.length }))
    const execute = vi.fn(async () => ({ ok: false, taskCount: 0 }))
    registryState.registry = {
      music_preview_op: makeTestOperation({
        id: 'music_preview_op',
        summary: 'music preview',
        intent: 'act',
        effects: {
          ...EFFECTS_WRITE,
          billable: true,
          externalSideEffects: true,
          longRunning: true,
        },
        confirmation: { kind: 'none', required: false },
        inputSchema: z.object({ prompt: z.string().min(1) }),
        outputSchema: z.object({ ok: z.boolean(), taskCount: z.number().int() }),
        plan: planMock,
        commit: commitMock,
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'music_preview_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'ask',
      source: 'assistant-panel',
      writer,
      input: { prompt: 'quiet cue' },
      toolCallId: 'tool-call-music',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toEqual(expect.objectContaining({
      code: 'OPERATION_EXECUTION_FAILED',
      details: expect.objectContaining({
        reasonCode: 'OPERATION_CONFIRMATION_REQUIRED',
      }),
    }))
    expect(planMock).toHaveBeenCalledTimes(1)
    expect(commitMock).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(writer.write).toHaveBeenCalledWith({
      type: 'data-agent-operation-plan-preview',
      data: expect.objectContaining({
        operationId: 'music_preview_op',
        toolCallId: 'tool-call-music',
        operationPlan: expect.objectContaining({
          quote: expect.objectContaining({
            billable: true,
            mediaTaskCount: 1,
            totalMaxFrozenCost: 2.5,
          }),
        }),
      }),
    })
  })

  it('[execution error] -> returns structured error', async () => {
    registryState.registry = {
      fail_op: makeTestOperation({
        id: 'fail_op',
        summary: 'fail',
        intent: 'act',
        effects: EFFECTS_WRITE,
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
