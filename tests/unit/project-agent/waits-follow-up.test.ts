import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaState = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  eventCount: vi.fn(),
  waitUpdateMany: vi.fn(),
}))

const eventState = vi.hoisted(() => ({
  appendProjectAgentEvents: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: prismaState.queryRaw,
    $executeRaw: prismaState.executeRaw,
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
}))

import { consumeProjectAgentWaitFollowUp } from '@/lib/project-agent/waits'

describe('project agent wait follow-up details', () => {
  beforeEach(() => {
    prismaState.queryRaw.mockReset()
    prismaState.executeRaw.mockReset()
    prismaState.eventCount.mockReset()
    prismaState.eventCount.mockResolvedValue(0)
    prismaState.waitUpdateMany.mockReset()
    eventState.appendProjectAgentEvents.mockClear()
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
        terminalStatus: 'failed',
        terminalTaskIds: ['task-1', 'task-2'],
        failedTaskIds: ['task-2'],
        followUpKey: 'project-agent-wait:wait-1:failed',
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

    const followUp = await consumeProjectAgentWaitFollowUp({
      runId: 'run-1',
      waitId: 'wait-1',
      claimId: 'claim-1',
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
  })
})
