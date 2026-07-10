import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  EFFECTS_NONE,
  RunContext,
  beforeEach,
  buildOperation,
  createProjectAgentOperationTool,
  describe,
  eventState,
  executeState,
  expect,
  it,
  prismaState,
  vi,
  type NextRequest,
  type ProjectAgentOperationDefinition,
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

  it('emits running activity for read-only query tools without an operation-start marker', async () => {
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    }
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation('get_project_context', 'query'),
      description: 'Get project context',
      projectId: 'project-1',
      userId: 'user-1',
      runFence: { runId: 'run-1', runVersion: 1, eventSeq: '1' },
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'auto',
      writer,
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-1',
        name: 'get_project_context',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(writer.write).toHaveBeenCalledWith({
      type: 'data-agent-activity',
      data: expect.objectContaining({
        runId: 'run-1',
        type: 'operation',
        status: 'running',
        operationId: 'get_project_context',
        toolCallId: 'call-1',
      }),
    })
    expect(writer.write).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'data-agent-operation-start',
    }))
    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: 'get_project_context',
    }))
  })

  it('does not wrap choice interruptions in a separate operation activity', async () => {
    const writer = {
      write: vi.fn(),
      merge: vi.fn(),
      onError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    }
    const operation = {
      ...buildOperation(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review, 'query'),
      effects: EFFECTS_NONE,
      confirmation: {
        kind: 'none' as const,
        required: false,
      },
      agentFlow: {
        interruptsFor: 'choice' as const,
      },
    } as ProjectAgentOperationDefinition
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation,
      description: 'Choose duration and aspect ratio',
      projectId: 'project-1',
      userId: 'user-1',
      runFence: { runId: 'run-1', runVersion: 1, eventSeq: '1' },
      context: {
        episodeId: 'episode-1',
        runId: 'run-1',
      },
      assistantPermissionMode: 'auto',
      writer,
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
    await tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-choice-1',
        name: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })

    expect(eventState.appendProjectAgentEvents).not.toHaveBeenCalled()
    expect(writer.write).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'data-agent-activity',
    }))
    expect(writer.write).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'data-agent-operation-start',
    }))
    expect(executeState.executeProjectAgentOperationFromTool).toHaveBeenCalledWith(expect.objectContaining({
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
      toolCallId: 'call-choice-1',
      input: {
        episodeId: 'episode-1',
      },
    }))
  })

  it('fails long-running assistant operations that do not return an async task signal', async () => {
    const onExecutionSettled = vi.fn()
    executeState.executeProjectAgentOperationFromTool.mockResolvedValueOnce({
      ok: true,
      data: {
        success: true,
      },
    })
    const tool = createProjectAgentOperationTool({
      request: new Request('http://localhost') as unknown as NextRequest,
      operation: buildOperation(),
      description: 'Generate images',
      projectId: 'project-1',
      userId: 'user-1',
      runFence: { runId: 'run-1', runVersion: 1, eventSeq: '1' },
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
      onExecutionSettled,
    })

    expect(tool.type).toBe('function')
    if (tool.type !== 'function') throw new Error('EXPECTED_FUNCTION_TOOL')
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
        code: 'OPERATION_OUTPUT_INVALID',
        message: 'PROJECT_AGENT_ASYNC_TASK_SIGNAL_MISSING',
        details: {
          expected: 'async_task_signal',
          reasonCode: 'PROJECT_AGENT_ASYNC_TASK_SIGNAL_MISSING',
        },
      },
    })
    expect(onExecutionSettled).toHaveBeenLastCalledWith({ ok: false })

    executeState.executeProjectAgentOperationFromTool.mockRejectedValueOnce(new Error('PROVIDER_THROWN'))
    await expect(tool.invoke(new RunContext(), JSON.stringify({ episodeId: 'episode-1' }), {
      toolCall: {
        type: 'function_call',
        callId: 'call-2',
        name: 'generate_edit_script_storyboard_images',
        arguments: JSON.stringify({ episodeId: 'episode-1' }),
      },
    })).resolves.toContain('PROVIDER_THROWN')
    expect(onExecutionSettled).toHaveBeenLastCalledWith({ ok: false })
  })
})
