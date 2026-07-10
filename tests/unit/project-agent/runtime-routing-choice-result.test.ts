import {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_CHOICE_TOOL_IDS,
  beforeEach,
  buildEditFirstChoiceResult,
  buildRequest,
  buildRun,
  buildWorkflow,
  createProjectAgentChatResponse,
  createRegistry,
  describe,
  drainCapturedResponseStream,
  expect,
  flushAsyncWork,
  it,
  loggerState,
  persistenceState,
  phaseState,
  registryState,
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
    workflowRefreshState.resolveEditFirstWorkflowState.mockResolvedValue(phaseState.editFirstWorkflow)
  })

  it('feeds the choice back as an in-band tool result while using workflow availability for next tools', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-choice-1',
      latestUserText: '民俗恐怖片',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          aspectRatio: '16:9',
        },
      },
    })
    expect(choiceResult).not.toBeNull()

    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-1',
        choiceType: 'bible_review',
        toolCallId: 'tool-choice-1',
        cardId: 'edit-first-duration-aspect-ratio',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '民俗恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedModelSettings).not.toHaveProperty('toolChoice')
    // The submitted choice travels as a synthetic in-band tool result, not via system prompt.
    expect(streamState.capturedSystem).not.toContain('剪辑先行选择卡续跑指令')
    const runInputItems = streamState.capturedRunInput as Array<Record<string, unknown>>
    expect(runInputItems.some((item) => item.type === 'function_call' && item.callId === 'tool-choice-1')).toBe(true)
    expect(runInputItems.some((item) => item.type === 'function_call_result' && item.callId === 'tool-choice-1')).toBe(true)
    expect(streamState.capturedToolNames).toContain('ingest_script')
    expect(streamState.capturedToolNames).toEqual(expect.arrayContaining([...EDIT_FIRST_CHOICE_OPERATION_IDS]))
    expect(streamState.capturedEnabledToolNames).toContain('ingest_script')
    expect(streamState.capturedEnabledToolNames).not.toContain(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)
  })

  it('fails explicitly when the authoritative choice continuation returns ok false', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-choice-review',
      latestUserText: '恐怖片',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          aspectRatio: '16:9',
        },
      },
    })
    expect(choiceResult).not.toBeNull()
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_style_previews', [
      'generate_edit_style_previews',
    ])
    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    const { executeProjectAgentOperationFromTool } = await import('@/lib/adapters/tools/execute-project-agent-operation')
    vi.mocked(executeProjectAgentOperationFromTool).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'OPERATION_EXECUTION_FAILED',
        message: 'provider rejected the request',
      },
    })

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-1',
        choiceType: 'bible_review',
        toolCallId: 'tool-choice-review',
        cardId: 'edit-first-bible-review',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '恐怖片' }] },
      ],
    })
    await drainCapturedResponseStream()

    expect(response.status).toBe(200)
    expect(runState.safelyUpdateProjectAgentRunStatus).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-choice_response',
      status: 'failed',
      stopReason: 'choice_continuation_missing',
      errorCode: 'PROJECT_AGENT_CHOICE_CONTINUATION_MISSING',
      errorMessage: 'Choice response did not execute required workflow continuation: generate_edit_style_previews',
    }))
  })

  it('does not expose bible review choice again after that choice was already approved', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-choice-review',
      latestUserText: '确认制作规划',
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          aspectRatio: '16:9',
        },
      },
    })
    expect(choiceResult).not.toBeNull()
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_style_previews', [
      'generate_edit_style_previews',
    ])

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-1',
        choiceType: 'bible_review',
        toolCallId: 'tool-choice-review',
        cardId: 'edit-first-bible-review',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '确认制作规划' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedEnabledToolNames).not.toContain(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)
    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_style_previews')
    expect(streamState.capturedEnabledToolNames).not.toContain('revise_bible')
  })
})
