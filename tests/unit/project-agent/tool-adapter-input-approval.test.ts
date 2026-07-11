import {
  EFFECTS_NONE,
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

  it('[invalid input] -> returns structured error with issues', async () => {
    registryState.registry = {
      test_op: makeTestOperation({
        id: 'test_op',
        summary: 'test',
        intent: 'act',
        effects: EFFECTS_NONE,
        inputSchema: z.object({ name: z.string().min(1) }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ ok: true })),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'test_op',
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
    expect(result.error.code).toBe('OPERATION_INPUT_INVALID')
    expect(result.error.issues).toBeDefined()
  })

  it('[legacy confirmed input] -> rejects the retired boolean approval path without executing', async () => {
    const writer = buildWriter()
    const execute = vi.fn(async () => ({ ok: true }))
    registryState.registry = {
      confirm_ok_op: makeTestOperation({
        id: 'confirm_ok_op',
        summary: 'confirm ok',
        intent: 'act',
        effects: EFFECTS_NONE,
        confirmation: {
          kind: 'destructive',
          required: true,
          summary: 'needs confirm',
        },
        inputSchema: z.object({ confirmed: z.boolean().optional() }),
        outputSchema: z.object({ ok: z.boolean() }),
        execute,
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'confirm_ok_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'ask',
      source: 'assistant-panel',
      writer,
      input: { confirmed: true },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('OPERATION_INPUT_INVALID')
    expect(result.error.details).toEqual(expect.objectContaining({
      code: 'LEGACY_OPERATION_CONFIRMATION_UNSUPPORTED',
    }))
    expect(execute).not.toHaveBeenCalled()
  })
})
