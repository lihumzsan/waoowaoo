import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaState = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  eventCount: vi.fn(),
  waitFindUnique: vi.fn(),
  waitUpdateMany: vi.fn(),
  activityFindUnique: vi.fn(),
}))

const eventState = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async () => null),
  appendProjectAgentEventsInTransaction: vi.fn(async (_tx: unknown, input: {
    events: Array<{ runFence: { runVersion: number; eventSeq: string } }>
  }) => {
    input.events[0].runFence.runVersion += 1
    input.events[0].runFence.eventSeq = '2'
    return null
  }),
}))

const persistenceState = vi.hoisted(() => ({
  appendProjectAssistantThreadMessagesInTransaction: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: prismaState.queryRaw,
    $executeRaw: prismaState.executeRaw,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => await callback({
      projectAgentWait: {
        findUnique: prismaState.waitFindUnique,
        updateMany: prismaState.waitUpdateMany,
      },
      projectAgentActivity: {
        findUnique: prismaState.activityFindUnique,
      },
    })),
    projectAgentEvent: {
      count: prismaState.eventCount,
    },
    projectAgentWait: {
      updateMany: prismaState.waitUpdateMany,
    },
  },
}))

vi.mock('@/lib/project-agent/event', () => ({
  appendProjectAgentEvents: eventState.appendProjectAgentEvents,
  appendProjectAgentEventsInTransaction: eventState.appendProjectAgentEventsInTransaction,
}))

vi.mock('@/lib/project-agent/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-agent/persistence')>()
  return {
    ...actual,
    appendProjectAssistantThreadMessagesInTransaction: persistenceState.appendProjectAssistantThreadMessagesInTransaction,
  }
})

import {
  claimProjectAgentWaitContinuation,
  startProjectAgentWaitFollowUp,
} from '@/lib/project-agent/waits'

describe('project agent wait follow-up details', () => {
  beforeEach(() => {
    prismaState.queryRaw.mockReset()
    prismaState.executeRaw.mockReset()
    prismaState.eventCount.mockReset()
    prismaState.eventCount.mockResolvedValue(0)
    prismaState.waitFindUnique.mockReset()
    prismaState.waitUpdateMany.mockReset()
    prismaState.waitUpdateMany.mockResolvedValue({ count: 1 })
    prismaState.activityFindUnique.mockReset()
    prismaState.activityFindUnique.mockResolvedValue(null)
    eventState.appendProjectAgentEvents.mockClear()
    eventState.appendProjectAgentEventsInTransaction.mockClear()
    persistenceState.appendProjectAssistantThreadMessagesInTransaction.mockClear()
  })

  it('atomically appends a visible Thread settlement when the wake-up budget is exhausted', async () => {
    prismaState.eventCount.mockResolvedValue(10)
    prismaState.queryRaw.mockResolvedValueOnce([{
      id: 'wait-budget',
      runId: 'run-budget',
      activityId: 'activity-budget',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      operationId: 'generate_episode_videos',
      taskIds: ['task-1'],
      followUpMode: 'resume_agent',
      status: 'claimed',
      runVersion: 1,
      eventSeq: BigInt(1),
      terminalStatus: 'completed',
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
      followUpKey: 'project-agent-wait:wait-budget:completed',
      followUpCommandId: 'command-budget',
      claimId: 'claim-budget',
      claimedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + 60_000),
      followedAt: null,
      createdAt: new Date(),
      resolvedAt: new Date(),
    }])

    await expect(startProjectAgentWaitFollowUp({
      runId: 'run-budget',
      waitId: 'wait-budget',
      commandId: 'command-budget',
      claimOwner: 'claim-budget',
      projectId: 'project-1',
      userId: 'user-1',
    })).resolves.toBeNull()

    expect(persistenceState.appendProjectAssistantThreadMessagesInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messages: [expect.objectContaining({
          id: 'workspace-assistant-run:wakeup-budget:run-budget:wait-budget',
        })],
      }),
    )
    expect(eventState.appendProjectAgentEventsInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({ event: expect.objectContaining({ kind: 'wait.followed' }) }),
          expect.objectContaining({ event: expect.objectContaining({ kind: 'run.failed' }) }),
        ]),
      }),
    )
  })

  it('includes failed task error details when consuming a claimed follow-up', async () => {
    prismaState.queryRaw
      .mockResolvedValueOnce([{
        id: 'wait-1',
        runId: 'run-1',
        activityId: 'activity-wait-1',
        projectId: 'project-1',
        userId: 'user-1',
        assistantId: 'workspace-command',
        scopeRef: 'episode:episode-1',
        episodeId: 'episode-1',
        operationId: 'generate_episode_videos',
        taskIds: ['task-1', 'task-2'],
        followUpMode: 'resume_agent',
        status: 'claimed',
        runVersion: 1,
        eventSeq: BigInt(1),
        terminalStatus: 'failed',
        terminalTaskIds: ['task-1', 'task-2'],
        failedTaskIds: ['task-2'],
        canceledTaskIds: [],
        followUpKey: 'project-agent-wait:wait-1:failed',
        followUpCommandId: 'command-1',
        claimId: 'claim-1',
        claimedAt: new Date(),
        claimExpiresAt: new Date(Date.now() + 60_000),
        followedAt: null,
        createdAt: new Date(),
        resolvedAt: new Date(),
      }])
      .mockResolvedValueOnce([{
        id: 'task-2',
        type: 'video_group',
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        status: 'failed',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'output video may be related to copyright restrictions',
      }])
    prismaState.waitFindUnique.mockResolvedValue({
      id: 'wait-1',
      runId: 'run-1',
      activityId: 'activity-wait-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      operationId: 'generate_episode_videos',
      taskIds: ['task-1', 'task-2'],
      followUpMode: 'resume_agent',
      status: 'claimed',
      runVersion: 1,
      eventSeq: BigInt(1),
      terminalStatus: 'failed',
      terminalTaskIds: ['task-1', 'task-2'],
      failedTaskIds: ['task-2'],
      canceledTaskIds: [],
      followUpKey: 'project-agent-wait:wait-1:failed',
      followUpCommandId: 'command-1',
      claimId: 'claim-1',
      claimedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + 60_000),
      followedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: new Date(),
    })

    const followUp = await startProjectAgentWaitFollowUp({
      runId: 'run-1',
      waitId: 'wait-1',
      commandId: 'command-1',
      claimOwner: 'claim-1',
      projectId: 'project-1',
      userId: 'user-1',
    })

    expect(followUp).toMatchObject({
      waitId: 'wait-1',
      operationId: 'generate_episode_videos',
      failedTaskIds: ['task-2'],
      failedTasks: [{
        taskId: 'task-2',
        taskType: 'video_group',
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        status: 'failed',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'output video may be related to copyright restrictions',
      }],
    })
    expect(eventState.appendProjectAgentEventsInTransaction).toHaveBeenCalledTimes(1)
    expect(prismaState.waitUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        runVersion: 2,
        eventSeq: BigInt(2),
      },
    }))
  })

  it('reuses the durable command activity without replaying activity.started on retry', async () => {
    const row = {
      id: 'wait-1',
      runId: 'run-1',
      activityId: 'activity-wait-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      operationId: 'plan_chapters',
      taskIds: ['task-1'],
      followUpMode: 'resume_agent',
      status: 'claimed',
      runVersion: 2,
      eventSeq: BigInt(2),
      terminalStatus: 'completed',
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
      followUpKey: 'project-agent-wait:wait-1:completed',
      followUpCommandId: 'command-1',
      claimId: 'claim-2',
      claimedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + 60_000),
      followedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: new Date(),
    }
    prismaState.queryRaw.mockResolvedValue([row])
    prismaState.waitFindUnique.mockResolvedValue(row)
    prismaState.activityFindUnique.mockResolvedValue({ runId: 'run-1', type: 'task_follow_up' })

    const followUp = await startProjectAgentWaitFollowUp({
      runId: 'run-1',
      waitId: 'wait-1',
      commandId: 'command-1',
      claimOwner: 'claim-2',
      projectId: 'project-1',
      userId: 'user-1',
    })

    expect(followUp).toMatchObject({ waitId: 'wait-1', followUpActivityId: 'command-1' })
    expect(eventState.appendProjectAgentEventsInTransaction).not.toHaveBeenCalled()
    expect(prismaState.waitUpdateMany).not.toHaveBeenCalled()
  })

  it('reclaims the same command from the fence persisted after activity.started', async () => {
    const row = {
      id: 'wait-1',
      runId: 'run-1',
      activityId: 'activity-wait-1',
      projectId: 'project-1',
      userId: 'user-1',
      assistantId: 'workspace-command',
      scopeRef: 'episode:episode-1',
      episodeId: 'episode-1',
      operationId: 'plan_chapters',
      taskIds: ['task-1'],
      followUpMode: 'resume_agent',
      status: 'resolved',
      runVersion: 2,
      eventSeq: BigInt(2),
      terminalStatus: 'completed',
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
      followUpKey: 'project-agent-wait:wait-1:completed',
      followUpCommandId: 'command-1',
      claimId: null,
      claimedAt: null,
      claimExpiresAt: null,
      followedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: new Date(),
    }
    prismaState.waitFindUnique.mockResolvedValue(row)
    prismaState.waitUpdateMany.mockResolvedValue({ count: 1 })

    const claimed = await claimProjectAgentWaitContinuation({
      waitId: 'wait-1',
      runId: 'run-1',
      expectedRunVersion: 1,
      expectedEventSeq: '1',
      commandId: 'command-1',
      claimOwner: 'claim-2',
    })

    expect(claimed.status).toBe('claimed')
    expect(prismaState.waitUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        runVersion: 2,
        eventSeq: BigInt(2),
      }),
    }))
  })
})
