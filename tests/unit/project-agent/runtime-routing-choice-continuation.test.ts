import {
  EDIT_FIRST_CHOICE_OPERATION_IDS,
  EDIT_FIRST_CHOICE_TOOL_IDS,
  beforeEach,
  buildEditFirstChoiceResult,
  buildRequest,
  buildRun,
  buildWorkflow,
  createProjectAgentChatResponse,
  createProjectAgentWait,
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
    runState.settleProjectAgentRunWithMessage.mockClear()
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

  it('keeps follow-up bible operations available after bible generation from a choice response', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('bible_ready_for_review', [
      'generate_edit_style_previews',
      'revise_bible',
    ])
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'bible_review',
      toolCallId: 'tool-choice-1',
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

    streamState.simulateSecondTurnAfterFirstWorkflowTool = true
    workflowRefreshState.resolveEditFirstWorkflowState.mockResolvedValueOnce(buildWorkflow('bible_ready_for_review', [
      'generate_edit_style_previews',
      'revise_bible',
    ]))

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
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.executedToolNames).toEqual(['confirm_bible'])
    expect(streamState.capturedEnabledToolNamesAfterExecution).not.toContain(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)
    expect(streamState.capturedEnabledToolNamesAfterExecution).toContain('generate_edit_style_previews')
    expect(streamState.capturedEnabledToolNamesAfterExecution).toContain('revise_bible')
  })

  it('keeps the interrupted approval operation available when resuming after workflow state changed', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('bible_ready_for_review', ['generate_edit_style_previews'])

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('approval_response'),
      control: {
        kind: 'approval',
        interruption: {
          id: 'interruption-1',
          runId: 'run-approval_response',
          activityId: 'activity-approval-1',
          type: 'approval',
          status: 'consumed',
          operationId: 'generate_edit_style_previews',
          approvalId: 'approval-1',
          toolCallId: 'tool-generate-bible-1',
          runState: 'serialized-state',
          payload: {
            operationPlan: { planSnapshotId: 'plan-snapshot-1' },
          },
        },
        approved: true,
        reason: null,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '民俗恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedToolNames).toContain('ingest_script')
    expect(streamState.capturedToolNames).toContain('generate_edit_style_previews')
    expect(streamState.capturedToolNames).toEqual(expect.arrayContaining([...EDIT_FIRST_CHOICE_OPERATION_IDS]))
  })

  it('binds async task waits after approval resume instead of returning to awaiting approval', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('bible_ready_for_review', ['generate_edit_style_previews'])
    streamState.simulateSecondTurnAfterFirstWorkflowTool = true

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('approval_response'),
      control: {
        kind: 'approval',
        interruption: {
          id: 'interruption-1',
          runId: 'run-approval_response',
          activityId: 'activity-approval-1',
          type: 'approval',
          status: 'consumed',
          operationId: 'generate_edit_style_previews',
          approvalId: 'approval-1',
          toolCallId: 'tool-generate-bible-1',
          runState: 'serialized-state',
          payload: {
            operationPlan: { planSnapshotId: 'plan-snapshot-1' },
          },
        },
        approved: true,
        reason: null,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '继续生成剧本' }] },
      ],
    })
    await drainCapturedResponseStream()

    expect(response.status).toBe(200)
    expect(createProjectAgentWait).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-approval_response',
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      operationId: 'generate_edit_style_previews',
      taskIds: ['task-generated-1'],
    }))
    expect(runState.safelyUpdateProjectAgentRunStatus).not.toHaveBeenCalledWith(expect.objectContaining({
      status: 'awaiting_task',
    }))
    expect(runState.safelyUpdateProjectAgentRunStatus).not.toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-approval_response',
      status: 'awaiting_approval',
    }))
  })
})
