import {
  RunContext,
  beforeEach,
  buildOperation,
  createProjectAgentApprovalPreflightStore,
  createProjectAgentOperationTool,
  describe,
  executeState,
  expect,
  it,
  prismaState,
  vi,
  type NextRequest,
} from './agents-tool-adapter.fixture'

describe('createProjectAgentOperationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaState.projectAgentEvent.findMany.mockResolvedValue([])
    prismaState.projectAgentEvent.count.mockResolvedValue(0)
    executeState.executeProjectAgentOperationFromTool.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        async: true,
        taskId: 'task-1',
        status: 'queued',
      },
    })
  })

  it('maps confirmation requirements to Agents SDK approval and preserves execution path', async () => {
    const onExecutionSettled = vi.fn()
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    }
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation(),
      description: 'Generate images',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'ask',
      writer,
      onExecutionSettled,
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    expect(await tool.needsApproval(new RunContext(), { episodeId: 'episode-1' }, 'call-1')).toBe(true)

    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'generate_edit_script_storyboard_images',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(writer.write).toHaveBeenCalledWith({
      type: 'data-agent-operation-start',
      data: {
        runId: 'run-1',
        operationId: 'generate_edit_script_storyboard_images',
        toolCallId: 'call-1',
      },
    })
    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script_storyboard_images',
      projectId: 'project-1',
      userId: 'user-1',
      toolCallId: 'call-1',
      assistantPermissionMode: 'ask',
      input: {
        episodeId: 'episode-1',
        confirmed: true,
      },
    }))
    expect(onExecutionSettled).toHaveBeenCalledWith({ ok: true })
  })

  it('returns approval preflight failures as standard tool results without executing the operation', async () => {
    const onExecutionSettled = vi.fn()
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    }
    const operation = {
      ...buildOperation(),
      plan: vi.fn(async () => {
        throw new Error('CAPABILITY_VALUE_NOT_ALLOWED: duration value 3 is not allowed')
      }),
    }
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation,
      description: 'Generate videos',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'ask',
      writer,
      approvalPreflightStore: createProjectAgentApprovalPreflightStore(),
      onExecutionSettled,
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    expect(await tool.needsApproval(new RunContext(), { episodeId: 'episode-1' }, 'call-1')).toBe(false)

    const result = await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'generate_edit_script_storyboard_images',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'OPERATION_EXECUTION_FAILED',
        message: 'CAPABILITY_VALUE_NOT_ALLOWED: duration value 3 is not allowed',
      },
    })
    expect(operation.plan).toHaveBeenCalledTimes(1)
    expect(executeState.executeProjectAgentOperationFromTool).not.toHaveBeenCalled()
    expect(writer.write).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'data-agent-operation-start',
    }))
    expect(onExecutionSettled).toHaveBeenCalledWith({ ok: false })
  })

  it('skips Agents SDK approval in auto mode while preserving the execution path', async () => {
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation(),
      description: 'Generate images',
      projectId: 'project-1',
      userId: 'user-1',
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'auto',
      writer: {
        write: vi.fn(),
        merge: vi.fn(),
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      },
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    expect(await tool.needsApproval(new RunContext(), { episodeId: 'episode-1' }, 'call-1')).toBe(false)

    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'generate_edit_script_storyboard_images',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script_storyboard_images',
      projectId: 'project-1',
      userId: 'user-1',
      assistantPermissionMode: 'auto',
      toolCallId: 'call-1',
      input: {
        episodeId: 'episode-1',
      },
    }))
  })
})
