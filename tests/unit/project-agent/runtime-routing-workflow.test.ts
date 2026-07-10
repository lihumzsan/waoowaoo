import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  beforeEach,
  buildEditFirstChoiceResult,
  buildRequest,
  buildRun,
  buildWorkflow,
  createProjectAgentChatResponse,
  createRegistry,
  describe,
  expect,
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
    workflowRefreshState.resolveEditFirstWorkflowState.mockResolvedValue(phaseState.editFirstWorkflow)
  })

  it('keeps bible review card available after bible generation', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('bible_ready_for_review', [
      'generate_edit_style_previews',
      'revise_bible',
    ])

    await runAssistant({ text: '剧本满意' })

    expect(streamState.capturedToolNames).toContain(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)
    expect(streamState.capturedToolNames).toContain('revise_bible')
    expect(streamState.capturedToolNames).toContain('generate_edit_style_previews')
  })

  it('enables only asset generation among act tools at the assets stage', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_assets', ['generate_edit_script_assets'])

    await runAssistant({ text: '继续生成资产' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_script_assets')
    expect(streamState.capturedEnabledToolNames).not.toContain('ingest_script')
  })

  it('enables asset revision after an asset review choice response sends revision notes', async () => {
    const choiceResult = buildEditFirstChoiceResult({
      choiceType: 'asset_review',
      toolCallId: 'tool-choice-asset',
      latestUserText: '民俗恐怖片',
      output: {
        ok: true,
        decision: 'revise',
        revisionNotes: '把祠堂场景调得更旧，空间关系更压迫',
      },
    })
    expect(choiceResult).not.toBeNull()
    phaseState.editFirstWorkflow = buildWorkflow('assets_ready_for_review', ['revise_edit_script_assets'])

    const response = await createProjectAgentChatResponse({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      assistantPermissionMode: 'ask',
      run: buildRun('choice_response'),
      control: {
        kind: 'choice',
        interruptionId: 'choice-interruption-asset',
        choiceType: 'asset_review',
        toolCallId: 'tool-choice-asset',
        cardId: 'edit-first-asset-review',
        choiceResult: choiceResult!,
      },
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: '民俗恐怖片' }] },
      ],
    })
    await flushAsyncWork()

    expect(response.status).toBe(200)
    expect(streamState.capturedEnabledToolNames).toContain('revise_edit_script_assets')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script_assets')
    expect(streamState.capturedEnabledToolNames).not.toContain(EDIT_FIRST_CHOICE_TOOL_IDS.asset_review)
  })

  it('skips execution approval in auto mode while keeping choice cards approval-free', async () => {
    const response = await runAssistant({ assistantPermissionMode: 'auto' })

    expect(response.status).toBe(200)
    expect(streamState.capturedTools.ingest_script.needsApproval).toBeUndefined()
    expect(streamState.capturedTools[EDIT_FIRST_CHOICE_TOOL_IDS.bible_review].needsApproval).toBeUndefined()
    expect(streamState.capturedSystem).toContain('当前权限模式：auto')
  })

  it('enables storyboard image generation but not video generation before images are ready', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_storyboard_images', [
      'generate_edit_script_storyboard_images',
    ])

    await runAssistant({ text: '生成分镜图片' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_script_storyboard_images')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_episode_videos')
  })

  it('enables spatial blocking but not storyboard panels immediately after cinematography', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_shot_execution_plan', [
      'generate_edit_shot_execution_plan',
    ])

    await runAssistant({ text: '继续生成下一步' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_edit_shot_execution_plan')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script_storyboard')
  })

  it('enables video generation only after storyboard images are ready', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_videos', ['generate_episode_videos'])

    await runAssistant({ text: '生成视频' })

    expect(streamState.capturedEnabledToolNames).toContain('generate_episode_videos')
    expect(streamState.capturedEnabledToolNames).not.toContain('generate_edit_script_storyboard_images')
  })

  it('exposes chapter render as the callable next action when ready chapters exist before all videos finish', async () => {
    phaseState.editFirstWorkflow = buildWorkflow('ready_to_generate_videos', [
      'render_chapters',
      'generate_episode_videos',
    ])

    await runAssistant({ text: '渲染第 1 章章节成片' })

    expect(streamState.capturedEnabledToolNames).toContain('render_chapters')
    expect(streamState.capturedEnabledToolNames).toContain('generate_episode_videos')
    const runInputItems = streamState.capturedRunInput as Array<Record<string, unknown>>
    const snapshotItem = runInputItems.find((item) => (
      item.role === 'system'
      && typeof item.content === 'string'
      && item.content.includes('[project_state_snapshot]')
    ))
    const content = snapshotItem?.content
    if (typeof content !== 'string') throw new Error('PROJECT_STATE_SNAPSHOT_TEST_CONTENT_MISSING')
    expect(content).toContain('workflowStage=ready_to_generate_videos')
    expect(content).toContain('workflowNextAction=render_chapters')
    expect(content).toContain('enabledOperationIds=')
    expect(content).toContain('render_chapters')
  })
})
