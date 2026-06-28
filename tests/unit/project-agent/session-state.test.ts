import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectAgentInterruptionSnapshot } from '@/lib/project-agent/interruptions'

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
    findFirst: vi.fn(async () => null),
  },
}))

const workflowMock = vi.hoisted(() => ({
  resolveEditFirstWorkflowState: vi.fn(async () => workflow),
}))

const runsMock = vi.hoisted(() => ({
  reconcileStaleRunningProjectAgentRunsForScope: vi.fn(async () => [] as string[]),
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
    },
  ]),
}))

const interruptionsMock = vi.hoisted(() => ({
  getPendingProjectAgentInterruptionForScope: vi.fn(async (): Promise<ProjectAgentInterruptionSnapshot | null> => ({
    id: 'interruption-1',
    runId: 'run-1',
    type: 'approval',
    status: 'pending',
    operationId: 'generate_edit_script_assets',
    approvalId: 'approval-1',
    toolCallId: 'tool-1',
    payload: {},
  })),
  getLatestProjectAgentInterruptionForRun: vi.fn(async (): Promise<ProjectAgentInterruptionSnapshot | null> => ({
    id: 'interruption-1',
    runId: 'run-1',
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
vi.mock('@/lib/project-agent/choice-card', () => choiceCardMock)

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
      },
    ])
    runsMock.reconcileStaleRunningProjectAgentRunsForScope.mockResolvedValue([])
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
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValue({
      id: 'interruption-1',
      runId: 'run-1',
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
    })
    expect(state.currentRun).toEqual({
      runId: 'run-1',
      status: 'awaiting_task',
      controlKind: 'approval_response',
      operationId: 'generate_edit_script_assets',
    })
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

  it('reconciles stale running runs before selecting the current session run', async () => {
    runsMock.reconcileStaleRunningProjectAgentRunsForScope.mockResolvedValueOnce(['run-stale-1'])
    runsMock.listRecentProjectAgentRunsForScope.mockResolvedValueOnce([
      {
        id: 'run-completed-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        requestId: 'request-completed-1',
        status: 'completed',
        controlKind: 'user_turn',
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce(null)
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce(null)

    const state = await getProjectAgentSessionState({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
      locale: 'zh',
    })

    expect(runsMock.reconcileStaleRunningProjectAgentRunsForScope).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      assistantId: 'workspace-command',
    })
    expect(state.currentRun).toEqual({
      runId: 'run-completed-1',
      status: 'completed',
      controlKind: 'user_turn',
      operationId: null,
    })
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
      },
    ])
    waitsMock.listProjectAgentSessionWaits.mockResolvedValueOnce([])
    interruptionsMock.getPendingProjectAgentInterruptionForScope.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-choice-1',
      type: 'choice',
      status: 'pending',
      operationId: 'request_edit_first_choice',
      approvalId: 'choice:approval-1',
      toolCallId: 'tool-choice-1',
      payload: { choiceType: 'screenplay_review', cardId: 'edit-first-screenplay-review' },
    })
    interruptionsMock.getLatestProjectAgentInterruptionForRun.mockResolvedValueOnce({
      id: 'choice-interruption-1',
      runId: 'run-choice-1',
      type: 'choice',
      status: 'pending',
      operationId: 'request_edit_first_choice',
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
})
