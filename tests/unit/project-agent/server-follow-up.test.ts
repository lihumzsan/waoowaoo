import { beforeEach, describe, expect, it, vi } from 'vitest'

const waitMock = vi.hoisted(() => ({
  claimResolvedProjectAgentWaitFollowUps: vi.fn(async (input: { episodeId?: string | null }) => (
    input.episodeId === 'episode-1'
      ? [{
          runId: 'run-1',
          activityId: 'activity-1',
          followUpActivityId: null,
          waitId: 'wait-1',
          followUpKey: 'follow-up-key-1',
          followUpMode: 'resume_agent',
          operationId: 'plan_chapters',
          taskIds: ['task-1'],
          failedTaskIds: [],
          failedTasks: [],
          terminalStatus: 'completed',
          total: 1,
          successCount: 1,
          failedCount: 0,
          claimId: 'claim-1',
        }]
      : []
  )),
  consumeProjectAgentWaitFollowUp: vi.fn(async () => ({
    runId: 'run-1',
    activityId: 'activity-1',
    followUpActivityId: 'activity-follow-up-1',
    waitId: 'wait-1',
    followUpKey: 'follow-up-key-1',
    followUpMode: 'resume_agent',
    operationId: 'plan_chapters',
    taskIds: ['task-1'],
    failedTaskIds: [],
    failedTasks: [],
    terminalStatus: 'completed',
    total: 1,
    successCount: 1,
    failedCount: 0,
    claimId: 'claim-1',
  })),
}))

const runMock = vi.hoisted(() => ({
  getProjectAgentRun: vi.fn(async () => ({
    id: 'run-1',
    projectId: 'project-1',
    userId: 'user-1',
    assistantId: 'workspace-command',
    scopeRef: 'episode:episode-1',
    episodeId: 'episode-1',
    requestId: 'request-1',
    status: 'awaiting_task',
    controlKind: 'user_turn',
    heartbeatAt: new Date('2026-07-03T00:00:00.000Z'),
  })),
  updateProjectAgentRunStatus: vi.fn(async () => undefined),
  safelyUpdateProjectAgentRunStatus: vi.fn(async () => undefined),
}))

const lockMock = vi.hoisted(() => ({
  acquireProjectAgentRunLock: vi.fn(async () => ({ key: 'lock-key', token: 'lock-token', runId: 'run-1' })),
  safelyReleaseProjectAgentRunLock: vi.fn(async () => undefined),
}))

const persistenceMock = vi.hoisted(() => ({
  loadProjectAssistantThread: vi.fn(async () => ({
    messages: [{
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: '开始制作' }],
    }],
  })),
}))

const runtimeMock = vi.hoisted(() => ({
  createProjectAgentChatResponse: vi.fn(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('ok'))
      controller.close()
    },
  }))),
}))

vi.mock('@/lib/project-agent/waits', () => waitMock)
vi.mock('@/lib/project-agent/runs', () => runMock)
vi.mock('@/lib/project-agent/run-lock', () => lockMock)
vi.mock('@/lib/project-agent/persistence', () => persistenceMock)
vi.mock('@/lib/project-agent/runtime', () => runtimeMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import { runResolvedProjectAgentWaitFollowUpsForTaskEvent } from '@/lib/project-agent/server-follow-up'

describe('project agent server follow-up', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('claims resolved resume waits and runs the follow-up without browser involvement', async () => {
    const result = await runResolvedProjectAgentWaitFollowUpsForTaskEvent({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(result).toEqual({ claimed: 1, ran: 1 })
    expect(waitMock.claimResolvedProjectAgentWaitFollowUps).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: 'episode-1',
      followUpMode: 'resume_agent',
    }))
    expect(waitMock.claimResolvedProjectAgentWaitFollowUps).toHaveBeenCalledWith(expect.objectContaining({
      episodeId: null,
      followUpMode: 'resume_agent',
    }))
    expect(waitMock.consumeProjectAgentWaitFollowUp).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      waitId: 'wait-1',
      claimId: 'claim-1',
    }))
    expect(runtimeMock.createProjectAgentChatResponse).toHaveBeenCalledWith(expect.objectContaining({
      assistantPermissionMode: 'ask',
      control: expect.objectContaining({
        kind: 'task_follow_up',
      }),
    }))
  })
})
