import {
  beforeEach,
  buildWorkflow,
  createRegistry,
  describe,
  drainCapturedResponseStream,
  expect,
  expectLastPersistedRunStatus,
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

  it('logs assistant message persistence failures during stream settlement', async () => {
    persistenceState.appendProjectAssistantThreadMessages.mockRejectedValueOnce(new Error('DB_DOWN'))

    const response = await runAssistant({ text: '生成剧本' })

    expect(response.status).toBe(200)
    await drainCapturedResponseStream()
    await vi.waitFor(() => {
      expect(loggerState.error).toHaveBeenCalledWith(expect.objectContaining({
        action: 'assistant.agents.settlement.failed',
        requestId: 'req-1',
        projectId: 'project-1',
        userId: 'user-1',
        details: expect.objectContaining({
          runId: 'run-user_turn',
          episodeId: 'episode-1',
          error: 'DB_DOWN',
        }),
      }))
    })
    expect(runHeartbeatState.stop).toHaveBeenCalled()
  })

  it('persists cancellation and stops heartbeat when the response reader disconnects', async () => {
    streamState.keepOpen = true

    const response = await runAssistant({ text: '生成剧本' })
    expect(response.status).toBe(200)

    const stream = streamState.capturedResponseStream
    if (!stream) throw new Error('TEST_RESPONSE_STREAM_MISSING')
    const reader = stream.getReader()
    await reader.cancel()

    expect(runState.settleProjectAgentRunWithMessage).toHaveBeenCalledWith(expect.objectContaining({
      runFence: expect.objectContaining({ runId: 'run-user_turn' }),
      status: 'cancelled',
      stopReason: 'stream_cancelled',
    }))
    expectLastPersistedRunStatus('cancelled', 'stream_cancelled')
    expect(runHeartbeatState.stop).toHaveBeenCalled()
  })

  it('fails loudly when live workflow refresh fails after a tool mutates state', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_edit_script', [
      'plan_chapters',
    ])
    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    workflowRefreshState.resolveEditFirstWorkflowState.mockRejectedValueOnce(new Error('DB_WORKFLOW_REFRESH_FAILED'))

    await expect(runAssistant({ text: '继续生成导演拆镜' })).rejects.toThrow(
      /PROJECT_AGENT_RUN_FAILED requestId=req-1: DB_WORKFLOW_REFRESH_FAILED/,
    )

    expect(streamState.executedToolNames).toEqual(['plan_chapters'])
    expect(streamState.capturedEnabledToolNamesAfterExecution).toEqual([])
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runFence: expect.objectContaining({ runId: 'run-user_turn' }),
      status: 'failed',
      stopReason: 'run_failed',
      errorCode: 'PROJECT_AGENT_RUN_FAILED',
      errorMessage: 'DB_WORKFLOW_REFRESH_FAILED',
    }))
  })

  it('cancels with the same run_lock_lost terminal when ownership is lost before response creation', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_edit_script', [
      'plan_chapters',
    ])
    runHeartbeatState.ownershipLossOnStart = Object.assign(
      new Error('PROJECT_AGENT_RUN_OWNERSHIP_LOST runId=run-user_turn reason=lock_not_owned'),
      { name: 'ProjectAgentRunOwnershipLostError' },
    )
    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    workflowRefreshState.resolveEditFirstWorkflowState.mockRejectedValueOnce(new Error('DB_WORKFLOW_REFRESH_FAILED'))

    await expect(runAssistant({ text: '继续生成导演拆镜' })).rejects.toThrow(
      /PROJECT_AGENT_RUN_FAILED requestId=req-1: DB_WORKFLOW_REFRESH_FAILED/,
    )

    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith({
      runFence: expect.objectContaining({ runId: 'run-user_turn' }),
      status: 'cancelled',
      expectedStatuses: ['running'],
      stopReason: 'run_lock_lost',
    })
  })
})
