import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'

const workflow = {
  active: true,
  stage: 'ready_to_generate_assets',
  blocking: {
    kind: 'needs_confirmation',
    reason: null,
  },
  nextAction: null,
  allowedOperationIds: ['generate_edit_script_assets'],
}

type MockInterruption = {
  id: string
  runId: string
  activityId: string | null
  type: 'approval' | 'choice'
  status: 'pending' | 'consumed'
  operationId: string
  approvalId: string
  toolCallId: string | null
  payload: Record<string, unknown>
}

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(async () => [
      {
        id: 'task-1',
        operationId: 'generate_edit_script_assets',
        type: 'image_location',
        targetType: 'LocationImage',
        targetId: 'location-image-1',
        status: 'processing',
      },
    ]),
  },
  projectEditScreenplay: {
    findFirst: vi.fn(async (): Promise<unknown | null> => null),
  },
}))

const workflowMock = vi.hoisted(() => ({
  resolveEditFirstWorkflowState: vi.fn(async () => workflow),
}))

const runsMock = vi.hoisted(() => ({
  cancelUnlockedRunningProjectAgentRunsForScope: vi.fn(async () => [] as string[]),
  listRecentProjectAgentRunsForScope: vi.fn(async () => [
    {
      id: 'run-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      requestId: 'request-1',
      status: 'awaiting_task',
      controlKind: 'approval_response',
      stopReason: 'awaiting_task',
    },
  ]),
}))

const interruptionsMock = vi.hoisted(() => ({
  getPendingProjectAgentInterruptionForScope: vi.fn(async (): Promise<MockInterruption | null> => ({
    id: 'interruption-1',
    runId: 'run-1',
    activityId: 'activity-approval-1',
    type: 'approval',
    status: 'pending',
    operationId: 'generate_edit_script_assets',
    approvalId: 'approval-1',
    toolCallId: 'tool-1',
    payload: {},
  })),
  getLatestProjectAgentInterruptionForRun: vi.fn(async (): Promise<MockInterruption | null> => ({
    id: 'interruption-1',
    runId: 'run-1',
    activityId: 'activity-approval-1',
    type: 'approval',
    status: 'pending',
    operationId: 'generate_edit_script_assets',
    approvalId: 'approval-1',
    toolCallId: 'tool-1',
    payload: {},
  })),
}))

const waitsMock = vi.hoisted(() => ({
  listProjectAgentSessionWaits: vi.fn(async () => [
    {
      runId: 'run-1',
      waitId: 'wait-1',
      operationId: 'generate_edit_script_assets',
      taskIds: ['task-1'],
      failedTaskIds: [],
      status: 'pending',
      followUpMode: 'resume_agent',
      terminalStatus: null,
      total: 1,
      claimId: null,
    },
  ]),
}))

const eventMock = vi.hoisted(() => ({
  getCurrentProjectAgentActivity: vi.fn(async (): Promise<unknown | null> => ({
    activityId: 'activity-wait-1',
    runId: 'run-1',
    type: 'waiting_task',
    status: 'waiting',
    operationId: 'generate_edit_script_assets',
    sourceOperationId: null,
    toolCallId: null,
    choiceType: null,
  })),
}))

const choiceCardMock = vi.hoisted(() => ({
  buildEditFirstAssistantChoiceCard: vi.fn(async () => ({
    cardId: 'edit-first-screenplay-review',
    runId: null,
    interruptionId: null,
    toolCallId: 'tool-choice-1',
    choiceType: 'screenplay_review',
    title: '审核剧本',
    groups: [],
    submitLabel: '确认',
    submit: { kind: 'submit_tool_output' },
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-workflow/edit-first', () => workflowMock)
vi.mock('@/lib/project-agent/runs', () => runsMock)
vi.mock('@/lib/project-agent/interruptions', () => interruptionsMock)
vi.mock('@/lib/project-agent/waits', () => waitsMock)
vi.mock('@/lib/project-agent/choice-card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-agent/choice-card')>()
  return {
    ...actual,
    buildEditFirstAssistantChoiceCard: choiceCardMock.buildEditFirstAssistantChoiceCard,
  }
})
vi.mock('@/lib/project-agent/event', () => eventMock)

import { getProjectAgentSessionState } from '@/lib/project-agent/session-state'

describe('project agent session-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        operationId: 'generate_edit_script_assets',
        type: 'image_location',
        targetType: 'LocationImage',
        targetId: 'location-image-1',
        status: 'processing',
      },
    ])
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValue(null)
    workflowMock.resolveEditFirstWorkflowState.mockResolvedValue(workflow)
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValue([
      {
        id: 'run-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-1',
        status: 'awaiting_task',
        controlKind: 'approval_response',
        stopReason: 'awaiting_task',
      },
    ])
    runsMock.cancelUnlockedRunningProjectAgentRunsForScope.mockResolvedValue([])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValue([
      {
        runId: 'run-1',
        waitId: 'wait-1',
        operationId: 'generate_edit_script_assets',
        taskIds: ['task-1'],
        failedTaskIds: [],
        status: 'pending',
        followUpMode: 'resume_agent',
        terminalStatus: null,
        total: 1,
        claimId: null,
      },
    ])
    eventMock.getCurrentProjectAgentActivity.mockResolvedValue({
      activityId: 'activity-wait-1',
      runId: 'run-1',
      type: 'waiting_task',
      status: 'waiting',
      operationId: 'generate_edit_script_assets',
      sourceOperationId: null,
      toolCallId: null,
      choiceType: null,
    })
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValue({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-approval-1',
      type: 'approval',
      status: 'pending',
      operationId: 'generate_edit_script_assets',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      payload: {},
    })
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValue({
      id: 'interruption-1',
      runId: 'run-1',
      activityId: 'activity-approval-1',
      type: 'approval',
      status: 'pending',
      operationId: 'generate_edit_script_assets',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      payload: {},
    })
  })

  it('returns pending approval and active task state from server rows after refresh', async () => {
    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.pendingInteraction).toEqual({
      kind: 'approval',
      runId: 'run-1',
      interruptionId: 'interruption-1',
      approvalId: 'approval-1',
      operationId: 'generate_edit_script_assets',
      toolCallId: 'tool-1',
      operationPlan: null,
    })
    expect(state.currentRun).toEqual({
      runId: 'run-1',
      status: 'awaiting_task',
      controlKind: 'approval_response',
    })
    expect(state.currentActivity).toEqual(expect.objectContaining({
      runId: 'run-1',
      type: 'waiting_task',
      status: 'waiting',
      operationId: 'generate_edit_script_assets',
    }))
    expect(state.activeWaits.map((wait) => wait.operationId)).toEqual(['generate_edit_script_assets'])
    expect(state.activeTasks).toEqual([{
      taskId: 'task-1',
      operationId: 'generate_edit_script_assets',
      taskType: 'image_location',
      targetType: 'LocationImage',
      targetId: 'location-image-1',
      status: 'processing',
    }])
  })

  it('rebuilds a pending choice card from the pending interruption row', async () => {
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([
      {
        id: 'run-choice-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-choice-1',
        status: 'awaiting_choice',
        controlKind: 'user_turn',
        stopReason: 'awaiting_user_choice',
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-choice-1',
      activityId: 'activity-choice-1',
      type: 'choice',
      status: 'pending',
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.screenplay_review,
      approvalId: 'choice:approval-1',
      toolCallId: 'tool-choice-1',
      payload: { choiceType: 'screenplay_review', cardId: 'edit-first-screenplay-review' },
    })
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-choice-1',
      activityId: 'activity-choice-1',
      type: 'choice',
      status: 'pending',
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.screenplay_review,
      approvalId: 'choice:approval-1',
      toolCallId: 'tool-choice-1',
      payload: { choiceType: 'screenplay_review', cardId: 'edit-first-screenplay-review' },
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(choiceCardMock.buildEditFirstAssistantChoiceCard).toHaveBeenCalledWith(expect.objectContaining({
      choiceType: 'screenplay_review',
      toolCallId: 'tool-choice-1',
    }))
    expect(state.pendingInteraction).toEqual(expect.objectContaining({
      kind: 'choice',
      runId: 'run-choice-1',
      interruptionId: 'choice-interruption-1',
      choiceType: 'screenplay_review',
      choiceCard: expect.objectContaining({
        runId: 'run-choice-1',
        interruptionId: 'choice-interruption-1',
      }),
    }))
  })

  it('keeps the awaiting style preview run id on the rebuilt style choice card after refresh', async () => {
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([
      {
        id: 'run-style-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-style-1',
        status: 'awaiting_choice',
        controlKind: 'user_turn',
        stopReason: 'awaiting_user_choice',
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce(null)
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce(null)
    eventMock.getCurrentProjectAgentActivity.mockResolvedValueOnce({
      activityId: 'activity-style-choice-1',
      runId: 'run-style-1',
      type: 'awaiting_choice',
      status: 'waiting',
      operationId: null,
      sourceOperationId: 'generate_edit_style_previews',
      toolCallId: null,
      choiceType: 'style',
    })
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValueOnce({
      id: 'screenplay-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      stylePreviews: [
        {
          id: 'style-preview-a',
          styleKey: 'style_a',
          title: '风格 A',
          summary: '风格 A 摘要',
          taskId: 'task-style-a',
          aspectRatio: '16:9',
          status: 'completed',
        },
      ],
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.currentRun).toEqual({
      runId: 'run-style-1',
      status: 'awaiting_choice',
      controlKind: 'user_turn',
    })
    expect(state.activeStylePreviewGeneration?.data).toEqual(expect.objectContaining({
      operationId: 'generate_edit_style_previews',
      agentRunId: 'run-style-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      screenplayId: 'screenplay-1',
      items: [
        expect.objectContaining({
          id: 'style-preview-a',
          taskId: 'task-style-a',
          aspectRatio: '16:9',
        }),
      ],
    }))
  })

  it('does not revive a consumed approval as the current operation after a stale run is cancelled', async () => {
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([
      {
        id: 'run-stale-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-stale-1',
        status: 'cancelled',
        controlKind: 'user_turn',
        stopReason: 'orphaned_running_run',
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce(null)
    eventMock.getCurrentProjectAgentActivity.mockResolvedValueOnce(null)
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce({
      id: 'interruption-stale-1',
      runId: 'run-stale-1',
      activityId: 'activity-stale-1',
      type: 'approval',
      status: 'consumed',
      operationId: 'generate_edit_script_storyboard',
      approvalId: 'approval-stale-1',
      toolCallId: 'tool-stale-1',
      payload: {},
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(runsMock.cancelUnlockedRunningProjectAgentRunsForScope).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
    expect(state.pendingInteraction).toBeNull()
    expect(state.currentRun).toEqual({
      runId: 'run-stale-1',
      status: 'cancelled',
      controlKind: 'user_turn',
    })
    expect(state.currentActivity).toBeNull()
  })

  it('keeps the approved operation visible while the approval response run is active', async () => {
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([
      {
        id: 'run-active-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-active-1',
        status: 'running',
        controlKind: 'user_turn',
        stopReason: 'approval_response',
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce(null)
    eventMock.getCurrentProjectAgentActivity.mockResolvedValueOnce({
      activityId: 'activity-active-1',
      runId: 'run-active-1',
      type: 'operation',
      status: 'running',
      operationId: 'generate_edit_shot_execution_plan',
      sourceOperationId: null,
      toolCallId: 'tool-active-1',
      choiceType: null,
    })
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce({
      id: 'interruption-active-1',
      runId: 'run-active-1',
      activityId: 'activity-active-1',
      type: 'approval',
      status: 'consumed',
      operationId: 'generate_edit_shot_execution_plan',
      approvalId: 'approval-active-1',
      toolCallId: 'tool-active-1',
      payload: {},
    })

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(state.currentRun).toEqual({
      runId: 'run-active-1',
      status: 'running',
      controlKind: 'user_turn',
    })
    expect(state.currentActivity).toEqual(expect.objectContaining({
      runId: 'run-active-1',
      type: 'operation',
      operationId: 'generate_edit_shot_execution_plan',
    }))
  })
})
