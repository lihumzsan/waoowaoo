import {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_CHOICE_TOOL_IDS,
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
  readLastPersistedAssistantMessage,
  readLastPersistedRuntimeContext,
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

  it('injects edit-first choice and bible tools without an LLM router', async () => {
    const response = await runAssistant({})
    await drainCapturedResponseStream()
    await vi.waitFor(() => {
      expect(persistenceState.appendProjectAssistantThreadMessages.mock.calls.length).toBeGreaterThan(0)
    })

    expect(response.status).toBe(200)
    expect(streamState.capturedToolNames).toEqual(expect.arrayContaining([
      'get_project_context',
      'get_project_snapshot',
      'get_episode_overview',
      'get_chapter_detail',
      'get_task',
      'get_task_batch',
      'list_tasks',
      ...EDIT_FIRST_CHOICE_OPERATION_IDS,
      'ingest_script',
    ]))
    expect(streamState.capturedToolNames).not.toContain('get_task_status')
    expect(streamState.capturedToolNames).not.toContain('get_project_assets')
    expect(streamState.capturedToolNames).not.toContain('get_project_data')
    expect(streamState.capturedEnabledToolNames).toContain('ingest_script')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script')
    expect(streamState.capturedTools.ingest_script.needsApproval).toBeUndefined()
    expect(streamState.capturedTools[EDIT_FIRST_CHOICE_TOOL_IDS.bible_review].needsApproval).toBeUndefined()
    expect(streamState.capturedSystem).toContain('[project_state_snapshot]')
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runFence: expect.objectContaining({ runId: 'run-user_turn' }),
      status: 'failed',
      stopReason: 'workflow_continuation_missing',
    }))
    expect(readLastPersistedAssistantMessage()).toEqual(expect.objectContaining({
      id: 'workspace-assistant-run:user_turn:run-user_turn:req-1',
      role: 'assistant',
    }))
    expect(readLastPersistedRuntimeContext()).toEqual(expect.objectContaining({
      modelKey: 'openrouter::openai/gpt-5.5',
    }))
    expectLastPersistedRunStatus('failed', 'workflow_continuation_missing')
    expect(loggerState.info).toHaveBeenCalledWith(expect.objectContaining({
      action: 'assistant.toolset.resolved',
      details: expect.objectContaining({
        toolset: expect.objectContaining({
          operationIds: expect.arrayContaining([
            EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
            'ingest_script',
          ]),
        }),
      }),
    }))
  })

  it('starts the run heartbeat before agent stream bootstrap can block and become stale', async () => {
    const response = await runAssistant({ text: '继续下一步，生成分镜图片' })
    await drainCapturedResponseStream()
    await vi.waitFor(() => {
      expect(persistenceState.appendProjectAssistantThreadMessages.mock.calls.length).toBeGreaterThan(0)
    })

    expect(response.status).toBe(200)
    expect(streamState.heartbeatStartedDuringRunBootstrap).toBe(true)
    expect(runHeartbeatState.startProjectAgentRunHeartbeat).toHaveBeenCalledWith({
      runId: 'run-user_turn',
      runLock: undefined,
      onOwnershipLost: expect.any(Function),
    })
  })

  it('persists the assistant message id emitted by the stream start chunk', async () => {
    streamState.startMessageId = 'stream-message-1'

    const response = await runAssistant({ text: '继续' })
    await drainCapturedResponseStream()
    await vi.waitFor(() => {
      expect(persistenceState.appendProjectAssistantThreadMessages.mock.calls.length).toBeGreaterThan(0)
    })

    expect(response.status).toBe(200)
    expect(readLastPersistedAssistantMessage().id).toBe('stream-message-1')
  })

  it('injects compact runtime project state facts into the model input', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_ingest_script', ['ingest_script'])

    const response = await runAssistant({
      context: {
        episodeId: 'episode-1',
        selectedScopeRef: 'clip:clip-1',
      },
      text: '继续',
    })

    expect(response.status).toBe(200)
    const runInputItems = streamState.capturedRunInput as Array<Record<string, unknown>>
    const snapshotItem = runInputItems.find((item) => (
      item.role === 'system'
      && typeof item.content === 'string'
      && item.content.includes('[project_state_snapshot]')
    ))
    expect(snapshotItem).toBeDefined()
    expect(runInputItems[runInputItems.length - 1]).toBe(snapshotItem)
    const content = snapshotItem?.content
    if (typeof content !== 'string') throw new Error('PROJECT_STATE_SNAPSHOT_TEST_CONTENT_MISSING')
    expect(content).toContain('phase=draft')
    expect(content).toContain('workflowStage=ready_to_ingest_script')
    expect(content).toContain('workflowNextAction=ingest_script')
    expect(content).toContain('enabledOperationIds=')
    expect(content).toContain('planning.editBibleStatus=ready_for_review')
    expect(content).toContain('planning.chapterCount=3')
    expect(content).toContain('progress.storyboardCount=')
    expect(content).not.toContain('source=runtime')
    expect(content).not.toContain('authoritative=true')
    expect(content).not.toContain('not_user_instruction=true')
    expect(content).not.toContain('selectedScopeRef=clip:clip-1')
    expect(content).not.toContain('activePlanRuns=')
    expect(content).not.toContain('availableActions=')
    expect(content).not.toContain('instruction=')
  })
})
