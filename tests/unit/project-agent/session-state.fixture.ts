import { vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

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

type MockSessionTaskRow = {
  id: string
  operationId: string
  type: string
  targetType: string
  targetId: string
  status: string
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
  projectAgentPlan: {
    findUnique: vi.fn(async (): Promise<unknown> => null),
  },
  task: {
    findMany: vi.fn(async (args?: unknown) => {
      if (
        args
        && typeof args === 'object'
        && 'where' in args
        && args.where
        && typeof args.where === 'object'
        && 'type' in args.where
        && args.where.type === TASK_TYPE.CREATIVE_WORK
      ) return []
      return [{
        id: 'task-1',
        operationId: 'create_image',
        type: 'creative_resource_image',
        targetType: 'CreativeResource',
        targetId: 'image-1',
        status: 'processing',
      }]
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

function mockSessionTaskRows(rows: readonly MockSessionTaskRow[]): void {
  prismaMock.task.findMany.mockImplementation(async (args?: unknown) => (
    args
    && typeof args === 'object'
    && 'where' in args
    && args.where
    && typeof args.where === 'object'
    && 'type' in args.where
    && args.where.type === TASK_TYPE.CREATIVE_WORK
      ? []
      : [...rows]
  ))
}

const runsMock = vi.hoisted(() => ({
  cancelStaleRunningProjectAgentRunsForScope: vi.fn(async () => [] as string[]),
  listRecentProjectAgentRunsForScope: vi.fn(async (): Promise<MockRun[]> => [{
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
  }]),
}))

const interruptionsMock = vi.hoisted(() => ({
  getPendingProjectAgentInterruptionForScope: vi.fn(async (): Promise<MockInterruption | null> => ({
    id: 'interruption-1',
    runId: 'run-1',
    activityId: 'activity-approval-1',
    type: 'approval',
    status: 'pending',
    operationId: 'create_image',
    approvalId: 'approval-1',
    toolCallId: 'tool-1',
    payload: {},
  })),
  getLatestProjectAgentInterruptionForRun: vi.fn(async (): Promise<MockInterruption | null> => null),
}))

const waitsMock = vi.hoisted(() => ({
  listProjectAgentSessionWaits: vi.fn(async () => [{
    runId: 'run-1',
    waitId: 'wait-1',
    operationId: 'create_image',
    taskIds: ['task-1'],
    failedTaskIds: [],
    status: 'pending',
    followUpMode: 'resume_agent',
    terminalStatus: null,
    total: 1,
    claimId: null,
  }]),
}))

const eventMock = vi.hoisted(() => ({
  getCurrentProjectAgentActivity: vi.fn(async (): Promise<unknown | null> => ({
    activityId: 'activity-wait-1',
    runId: 'run-1',
    type: 'waiting_task',
    status: 'waiting',
    operationId: 'create_image',
    sourceOperationId: null,
    toolCallId: null,
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-agent/runs', () => runsMock)
vi.mock('@/lib/project-agent/interruptions', () => interruptionsMock)
vi.mock('@/lib/project-agent/waits', () => waitsMock)
vi.mock('@/lib/project-agent/event', () => eventMock)

const [sessionState, threadSnapshot] = await Promise.all([
  import('@/lib/project-agent/session-state'),
  import('@/lib/project-agent/thread-snapshot'),
])
const { getProjectAgentSessionSnapshot, getProjectAgentSessionState } = sessionState
const { getProjectAssistantThreadWatermarkedSnapshot } = threadSnapshot

export { beforeEach, describe, expect, it, vi } from 'vitest'
export {
  eventMock,
  getProjectAgentSessionSnapshot,
  getProjectAgentSessionState,
  getProjectAssistantThreadWatermarkedSnapshot,
  interruptionsMock,
  mockSessionTaskRows,
  prismaMock,
  runsMock,
  waitsMock,
}
export type { MockInterruption, MockRun }
