import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  beforeEach,
  buildRequest,
  buildRun,
  buildWorkflow,
  createProjectAgentChatResponse,
  createRegistry,
  describe,
  drainCapturedResponseStream,
  expect,
  expectLastPersistedRunStatus,
  flushAsyncWork,
  it,
  loggerState,
  persistenceState,
  phaseState,
  registryState,
  runAssistant,
  runHeartbeatState,
  runLockState,
  runState,
  streamState,
  vi,
  workflowRefreshState,
} from './runtime-routing.fixture'

describe('project agent runtime deterministic tool injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamState.capturedToolNames = []
    streamState.capturedEnabledToolNames = []
    streamState.capturedEnabledToolNamesAfterExecution = []
    streamState.capturedTools = {}
    streamState.capturedSystem = ''
    streamState.capturedModelSettings = {}
    streamState.capturedRunInput = null
    streamState.capturedResponseStream = null
    streamState.streamError = null
    streamState.keepOpen = false
    streamState.startMessageId = null
    streamState.simulateSecondTurnAfterFirstWorkflowTool = false
    streamState.executedToolNames = []
    streamState.heartbeatStartedDuringRunBootstrap = false
    loggerState.info.mockReset()
    loggerState.error.mockReset()
    runState.safelyUpdateProjectAgentRunStatus.mockClear()
    runState.cancelRunningProjectAgentRun.mockClear()
    runHeartbeatState.stop.mockClear()
    runHeartbeatState.ownershipLossOnStart = null
    runHeartbeatState.startProjectAgentRunHeartbeat.mockClear()
    persistenceState.appendProjectAssistantThreadMessages.mockClear()
    runLockState.safelyReleaseProjectAgentRunLock.mockClear()
    registryState.registry = createRegistry()
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_ingest_script', ['ingest_script'])
    workflowRefreshState.resolveEditFirstWorkflowState.mockReset()
    workflowRefreshState.resolveEditFirstWorkflowState.mockImplementation(async () => phaseState.editFirstWorkflow)
  })

  it('projects a declined approval into the model input before the user message', async () => {
    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun(),
      control: {
        kind: 'user_turn',
        declinedInterruptions: [{
          id: 'interruption-1',
          approvalId: 'approval-1',
          runId: 'run-previous',
          activityId: 'activity-previous-approval',
          type: 'approval',
          operationId: 'generate_edit_script',
        }],
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '先回答我一个问题' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    const runInputItems = streamState.capturedRunInput as Array<Record<string, unknown>>
    const noteIndex = runInputItems.findIndex((item) => (
      item.role === 'user' && typeof item.content === 'string' && item.content.includes('[approval_declined]')
    ))
    const userIndex = runInputItems.findIndex((item) => (
      item.role === 'user' && typeof item.content === 'string' && item.content.includes('先回答我一个问题')
    ))
    expect(noteIndex).toBeGreaterThanOrEqual(0)
    expect(userIndex).toBeGreaterThanOrEqual(0)
    expect(noteIndex).toBeLessThan(userIndex)
    expect(runInputItems[noteIndex].content).toContain('operation=generate_edit_script')
  })

  it('injects the chapter planning operation on the single assistant path', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_edit_script', ['plan_chapters'])

    await runAssistant({
      context: { episodeId: 'episode-1' },
      text: '继续生成核心剪辑表',
    })

    expect(streamState.capturedToolNames).toContain('get_project_context')
    expect(streamState.capturedToolNames).toContain('get_episode_overview')
    expect(streamState.capturedToolNames).toContain(EDIT_FIRST_CHOICE_TOOL_IDS.style)
    expect(streamState.capturedToolNames).toContain('plan_chapters')
    expect(streamState.capturedToolNames).toContain('generate_edit_script')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script')
  })

  it('logs and marks the run failed when the UI stream fails before finish', async () => {
    streamState.streamError = new Error('BROKEN_STREAM')

    const response = await runAssistant({ text: '生成剧本' })

    expect(response.status).toBe(200)
    await expect(drainCapturedResponseStream()).rejects.toThrow('BROKEN_STREAM')
    expect(loggerState.error).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assistant.agents.stream.failed',
      requestId: 'req-1',
      projectId: 'project-1',
      userId: 'user-1',
      details: expect.objectContaining({
        runId: 'run-user_turn',
        episodeId: 'episode-1',
        error: 'BROKEN_STREAM',
        workflowStage: 'ready_to_ingest_script',
        runStatusFinalized: false,
      }),
    }))
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runFence: expect.objectContaining({ runId: 'run-user_turn' }),
      status: 'failed',
      stopReason: 'stream_error',
      errorCode: 'PROJECT_AGENT_STREAM_FAILED',
      errorMessage: 'BROKEN_STREAM',
    }))
    expectLastPersistedRunStatus('failed', 'stream_error')
    expect(runHeartbeatState.stop).toHaveBeenCalled()
  })

  it('cancels the run with run_lock_lost when ownership is lost after the stream is established', async () => {
    runHeartbeatState.ownershipLossOnStart = Object.assign(
      new Error('PROJECT_AGENT_RUN_OWNERSHIP_LOST runId=run-user_turn reason=lock_not_owned'),
      { name: 'ProjectAgentRunOwnershipLostError' },
    )
    streamState.streamError = new Error('ABORTED_STREAM')

    const response = await runAssistant({ text: '生成剧本' })

    expect(response.status).toBe(200)
    await expect(drainCapturedResponseStream()).rejects.toThrow('ABORTED_STREAM')
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runFence: expect.objectContaining({ runId: 'run-user_turn' }),
      status: 'cancelled',
      stopReason: 'run_lock_lost',
    }))
    expectLastPersistedRunStatus('cancelled', 'run_lock_lost')
  })
})
