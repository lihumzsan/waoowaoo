import { beforeEach, describe, expect, it, vi } from 'vitest'

const waitMock = vi.hoisted(() => ({
  claimProjectAgentWaitContinuation: vi.fn(async () => ({
    status: 'claimed' as const,
    projectId: 'project-1',
    userId: 'user-1',
    episodeId: 'episode-1',
    followUp: {
      runId: 'run-1', activityId: 'activity-1', followUpActivityId: 'outbox-1',
      waitId: 'wait-1', followUpKey: 'follow-up-key-1', followUpMode: 'resume_agent',
      operationId: 'plan_chapters', taskIds: ['task-1'], failedTaskIds: [], canceledTaskIds: [],
      failedTasks: [], terminalStatus: 'completed', total: 1, successCount: 1,
      failedCount: 0, canceledCount: 0, claimId: 'owner-1', commandId: 'outbox-1',
    },
  })),
  startProjectAgentWaitFollowUp: vi.fn(async (input: { commandId: string; claimOwner: string }) => ({
    runId: 'run-1', activityId: 'activity-1', followUpActivityId: input.commandId,
    waitId: 'wait-1', followUpKey: 'follow-up-key-1', followUpMode: 'resume_agent',
    operationId: 'plan_chapters', taskIds: ['task-1'], failedTaskIds: [], canceledTaskIds: [],
    failedTasks: [], terminalStatus: 'completed', total: 1, successCount: 1,
    failedCount: 0, canceledCount: 0, claimId: input.claimOwner, commandId: input.commandId,
  })),
  finalizeProjectAgentWaitFollowUp: vi.fn(async () => undefined),
  releaseProjectAgentWaitContinuationClaim: vi.fn(async () => true),
  extendProjectAgentWaitContinuationClaim: vi.fn(async () => true),
}))

const runMock = vi.hoisted(() => ({
  getProjectAgentRun: vi.fn(async () => ({
    id: 'run-1', projectId: 'project-1', userId: 'user-1', assistantId: 'workspace-command',
    scopeRef: 'episode:episode-1', episodeId: 'episode-1', requestId: 'request-1',
    status: 'awaiting_task', controlKind: 'user_turn', runVersion: 1, eventSeq: BigInt(1),
    heartbeatAt: new Date('2026-07-03T00:00:00.000Z'),
  })),
}))

const runtimeMock = vi.hoisted(() => ({
  createProjectAgentChatResponse: vi.fn(async (input: { settleTaskFollowUp?: (outcome: 'completed') => Promise<void> }) => {
    await input.settleTaskFollowUp?.('completed')
    return new Response('ok')
  }),
}))

vi.mock('@/lib/project-agent/waits', () => waitMock)
vi.mock('@/lib/project-agent/runs', () => runMock)
vi.mock('@/lib/project-agent/run-lock', () => ({
  acquireProjectAgentRunLock: vi.fn(async () => ({ key: 'lock-key', token: 'lock-token', runId: 'run-1' })),
  safelyReleaseProjectAgentRunLock: vi.fn(async () => undefined),
}))
vi.mock('@/lib/project-agent/persistence', () => ({
  loadProjectAssistantThread: vi.fn(async () => ({ messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'start' }] }] })),
}))
vi.mock('@/lib/project-agent/runtime', () => runtimeMock)
vi.mock('@/lib/logging/core', () => ({ createScopedLogger: vi.fn(() => ({ warn: vi.fn(), error: vi.fn() })) }))

import { runProjectAgentWaitContinuationCommand } from '@/lib/project-agent/server-follow-up'

describe('project agent durable server follow-up', () => {
  beforeEach(() => vi.clearAllMocks())

  it('settles the claimed wait only through the runtime persistence settlement callback', async () => {
    await runProjectAgentWaitContinuationCommand({
      kind: 'project_agent.continue_wait', version: 1, waitId: 'wait-1', runId: 'run-1',
      expectedRunVersion: 1, expectedEventSeq: '1',
    }, 'outbox-1')

    expect(runtimeMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      control: expect.objectContaining({ kind: 'task_follow_up' }),
      settleTaskFollowUp: expect.any(Function),
    }))
    expect(waitMock.finalizeProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      waitId: 'wait-1', commandId: 'outbox-1', outcome: 'completed',
    }))
    expect(waitMock.releaseProjectAgentWaitContinuationClaim).not.toHaveBeenCalled()
  })
})
