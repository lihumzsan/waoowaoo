import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaState = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    projectAgentEvent: {
      findMany: prismaState.findMany,
      count: prismaState.count,
    },
  },
}))

import {
  buildProjectAgentOperationTargetKey,
  enforceProjectAgentOperationRunBudget,
  isProjectAgentRunWakeupBudgetAvailable,
} from '@/lib/project-agent/run-budget'

describe('project agent run budget', () => {
  beforeEach(() => {
    prismaState.findMany.mockReset()
    prismaState.count.mockReset()
  })

  it('derives target keys from business ids before falling back to episode scope', () => {
    expect(buildProjectAgentOperationTargetKey({
      operationId: 'replan_chapter',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      toolInput: { chapterId: 'chapter-1' },
    })).toBe('chapterId:chapter-1')

    expect(buildProjectAgentOperationTargetKey({
      operationId: 'plan_chapters',
      projectId: 'project-1',
      context: { episodeId: 'episode-1' },
      toolInput: {},
    })).toBe('episodeId:episode-1')
  })

  it('blocks the third same-operation same-target attempt in a run', async () => {
    prismaState.findMany.mockResolvedValue([
      {
        kind: 'activity.started',
        payload: {
          kind: 'activity.started',
          type: 'operation',
          operationId: 'replan_chapter',
          targetKey: 'chapterId:chapter-1',
        },
      },
      {
        kind: 'activity.started',
        payload: {
          kind: 'activity.started',
          type: 'operation',
          operationId: 'replan_chapter',
          targetKey: 'chapterId:chapter-1',
        },
      },
    ])

    const result = await enforceProjectAgentOperationRunBudget({
      projectId: 'project-1',
      userId: 'user-1',
      runId: 'run-1',
      operationId: 'replan_chapter',
      targetKey: 'chapterId:chapter-1',
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'OPERATION_NOT_ALLOWED',
        message: 'PROJECT_AGENT_OPERATION_TARGET_BUDGET_EXCEEDED',
        details: {
          attempts: 2,
          limit: 2,
        },
      },
    })
  })

  it('blocks after three consecutive failed activities in a run', async () => {
    prismaState.findMany.mockResolvedValue([
      { kind: 'activity.failed', payload: { kind: 'activity.failed' } },
      { kind: 'activity.failed', payload: { kind: 'activity.failed' } },
      { kind: 'activity.failed', payload: { kind: 'activity.failed' } },
    ])

    const result = await enforceProjectAgentOperationRunBudget({
      projectId: 'project-1',
      userId: 'user-1',
      runId: 'run-1',
      operationId: 'get_project_snapshot',
      targetKey: 'episodeId:episode-1',
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        message: 'PROJECT_AGENT_CONSECUTIVE_FAILURE_BUDGET_EXCEEDED',
        details: {
          consecutiveFailures: 3,
          limit: 3,
        },
      },
    })
  })

  it('allows no more than ten automatic task follow-up wakeups per run', async () => {
    prismaState.count.mockResolvedValueOnce(9)
    await expect(isProjectAgentRunWakeupBudgetAvailable({
      projectId: 'project-1',
      userId: 'user-1',
      runId: 'run-1',
    })).resolves.toBe(true)

    prismaState.count.mockResolvedValueOnce(10)
    await expect(isProjectAgentRunWakeupBudgetAvailable({
      projectId: 'project-1',
      userId: 'user-1',
      runId: 'run-1',
    })).resolves.toBe(false)
  })
})
