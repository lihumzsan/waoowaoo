import { vi } from 'vitest'

import { createEditFirstWorkflowView } from '@/lib/project-workflow/edit-first-view'

const workflow = createEditFirstWorkflowView({
  step: 'planned_assets',
  status: { kind: 'ready', reason: null },
})

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

type MockRun = {
  id: string
  projectId: string
  userId: string
  assistantId: string
  scopeRef: string
  episodeId: string | null
  requestId: string
  status: string
  controlKind: string
  stopReason?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [
    { kind: 'WAIT', id: 'wait-1', runId: 'run-1' },
    { kind: 'INTERRUPTION', id: 'interruption-1', runId: 'run-1' },
    { kind: 'ACTIVITY', id: 'activity-wait-1', runId: 'run-1' },
  ]),
  projectAgentEvent: {
    findFirst: vi.fn(async () => ({ id: BigInt(42) })),
  },
  projectAssistantThread: {
    findUnique: vi.fn(async (): Promise<unknown> => null),
  },
  task: {
    findMany: vi.fn(async (args?: unknown) => {
      void args
      return [
        {
          id: 'task-1',
          operationId: 'generate_edit_script_assets',
          type: 'image_location',
          targetType: 'LocationImage',
          targetId: 'location-image-1',
          status: 'processing',
        },
      ]
    }),
  },
  projectAgentRun: {
    findMany: vi.fn(async () => [{
      id: 'run-1',
      status: 'awaiting_task',
      controlKind: 'approval_response',
      errorCode: null,
      errorMessage: null,
    }]),
  },
}))

const workflowMock = vi.hoisted(() => ({
  resolveEditFirstWorkflowView: vi.fn(async () => workflow),
}))

const runsMock = vi.hoisted(() => ({
  cancelStaleRunningProjectAgentRunsForScope: vi.fn(async () => [] as string[]),
  listRecentProjectAgentRunsForScope: vi.fn(async (): Promise<MockRun[]> => [
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
    cardId: 'edit-first-bible-review',
    runId: null,
    interruptionId: null,
    toolCallId: 'tool-choice-1',
    choiceType: 'bible_review',
    replyMode: 'whole_card',
    title: '确认制作规划',
    groups: [],
    submitLabel: '确认',
    submit: { kind: 'submit_tool_output', decision: 'approve' },
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

vi.mock('@/lib/project-workflow/edit-first', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/project-workflow/edit-first')>(),
  ...workflowMock,
}))

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

const [sessionState, threadSnapshot, choiceTools] = await Promise.all([
  import('@/lib/project-agent/session-state'),
  import('@/lib/project-agent/thread-snapshot'),
  import('@/lib/project-agent/edit-first-choice-tools'),
])
const { getProjectAgentSessionSnapshot, getProjectAgentSessionState } = sessionState
const { getProjectAssistantThreadWatermarkedSnapshot } = threadSnapshot
const { EDIT_FIRST_CHOICE_TOOL_IDS } = choiceTools

export { beforeEach, describe, expect, it, vi } from 'vitest'
export {
  choiceCardMock,
  EDIT_FIRST_CHOICE_TOOL_IDS,
  eventMock,
  getProjectAgentSessionSnapshot,
  getProjectAgentSessionState,
  getProjectAssistantThreadWatermarkedSnapshot,
  interruptionsMock,
  prismaMock,
  runsMock,
  waitsMock,
  workflow,
  workflowMock,
}
export type { MockInterruption, MockRun }
