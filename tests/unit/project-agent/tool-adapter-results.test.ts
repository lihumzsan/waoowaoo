import {
  EFFECTS_NONE,
  EFFECTS_WRITE,
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

  it('[interrupting operation error] -> marks the failed interaction boundary in details', async () => {
    registryState.registry = {
      choice_op: makeTestOperation({
        id: 'choice_op',
        summary: 'choice',
        intent: 'query',
        effects: EFFECTS_NONE,
        confirmation: { kind: 'none', required: false },
        agentFlow: { interruptsFor: 'choice' },
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw new Error('choice setup failed')
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'choice_op',
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
    expect(result.error.details).toEqual({ interruptsFor: 'choice' })
  })

  it('[execution throws undefined] -> returns fallback message', async () => {
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

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'fail_undefined',
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
    expect(result.error.message).toBe('PROJECT_AGENT_OPERATION_FAILED')
  })

  it('[execution throws symbol] -> returns fallback message', async () => {
    registryState.registry = {
      fail_symbol: makeTestOperation({
        id: 'fail_symbol',
        summary: 'fail symbol',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw Symbol('boom')
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'fail_symbol',
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
    expect(result.error.message).toBe('PROJECT_AGENT_OPERATION_FAILED')
  })

  it('[execution throws function] -> returns fallback message', async () => {
    registryState.registry = {
      fail_function: makeTestOperation({
        id: 'fail_function',
        summary: 'fail function',
        intent: 'act',
        effects: EFFECTS_WRITE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => {
          throw (() => 'boom')
        }),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'fail_function',
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
    expect(result.error.message).toBe('PROJECT_AGENT_OPERATION_FAILED')
  })

  it('[output schema mismatch] -> returns structured error', async () => {
    registryState.registry = {
      output_op: makeTestOperation({
        id: 'output_op',
        summary: 'output',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ missing: true } as unknown as { ok: boolean })),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'output_op',
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
    expect(result.error.code).toBe('OPERATION_OUTPUT_INVALID')
    expect(result.error.issues).toBeDefined()
  })

  it('[success] -> wraps output in ok data', async () => {
    registryState.registry = {
      ok_op: makeTestOperation({
        id: 'ok_op',
        summary: 'ok',
        intent: 'query',
        effects: EFFECTS_NONE,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: vi.fn(async () => ({ ok: true })),
      }),
    }

    const result = await executeProjectAgentOperationFromTool({
      request: buildRequest(),
      operationId: 'ok_op',
      projectId: 'project-1',
      userId: 'user-1',
      context: {},
      assistantPermissionMode: 'auto',
      source: 'assistant-panel',
      writer: buildWriter(),
      input: {},
    })

    expect(result).toEqual({
      ok: true,
      data: { ok: true },
    })
  })
})
