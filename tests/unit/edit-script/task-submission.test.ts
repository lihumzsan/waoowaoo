import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectEditBible: {
    findFirst: vi.fn(),
  },
  projectEditScript: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  projectEditChapter: {
    findFirst: vi.fn(),
  },
  projectEditShotExecutionPlan: {
    findFirst: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
  },
}))

const submitOperationTaskMock = vi.hoisted(() => vi.fn())
const submitOperationTaskBatchMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/operations/submit-operation-task', () => ({
  submitOperationTask: submitOperationTaskMock,
  submitOperationTaskBatch: submitOperationTaskBatchMock,
}))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
    storyboardModel: 'fal::gpt-image-2',
  })),
}))

import {
  submitProjectEditShotExecutionPlanTask,
  submitProjectEditShotExecutionPlanBatchTasks,
} from '@/lib/edit-script/task-submission'

function request(): NextRequest {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'accept-language': 'zh' },
  }) as unknown as NextRequest
}

function mockSubmitResult(taskId: string) {
  return {
    success: true,
    async: true,
    taskId,
    runId: null,
    status: 'queued',
    deduped: false,
  }
}

describe('edit shot execution plan task submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.projectEditShotExecutionPlan.findFirst.mockResolvedValue(null)
    prismaMock.projectEditChapter.findFirst.mockImplementation(async (input: { readonly where: { readonly id: string } }) => ({
      id: input.where.id,
    }))
  })

  it('submits a batch only for episode edit scripts missing a ready shot execution plan', async () => {
    prismaMock.projectEditScript.findMany.mockResolvedValue([
      {
        id: 'script-ready',
        episodeId: 'episode-1',
        chapterId: 'chapter-ready',
        shotExecutionPlan: { status: 'ready' },
      },
      {
        id: 'script-missing',
        episodeId: 'episode-1',
        chapterId: 'chapter-missing',
        shotExecutionPlan: null,
      },
      {
        id: 'script-failed',
        episodeId: 'episode-1',
        chapterId: 'chapter-failed',
        shotExecutionPlan: { status: 'failed' },
      },
    ])
    submitOperationTaskBatchMock.mockResolvedValueOnce([
      mockSubmitResult('task-missing'),
      mockSubmitResult('task-failed'),
    ])

    const result = await submitProjectEditShotExecutionPlanBatchTasks({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      source: 'project-agent',
      locale: 'zh',
    })

    expect(prismaMock.projectEditScript.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        status: 'ready',
      },
    }))
    expect(submitOperationTaskBatchMock).toHaveBeenCalledWith([
      expect.objectContaining({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: 'script-missing',
      operationId: 'generate_edit_shot_execution_plan',
      dedupeKey: 'edit_shot_execution_plan_generate:project-1:script-missing',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        chapterId: 'chapter-missing',
        editScriptId: 'script-missing',
        displayMode: 'detail',
      }),
      }),
      expect.objectContaining({
      targetId: 'script-failed',
      dedupeKey: 'edit_shot_execution_plan_generate:project-1:script-failed',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      payload: expect.objectContaining({
        chapterId: 'chapter-failed',
        editScriptId: 'script-failed',
      }),
      }),
    ])
    expect(result).toEqual(expect.objectContaining({
      success: true,
      async: true,
      episodeId: 'episode-1',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      total: 2,
      taskIds: ['task-missing', 'task-failed'],
    }))
    expect(result.results).toEqual([
      expect.objectContaining({
        refId: 'script-missing',
        taskId: 'task-missing',
        targetId: 'script-missing',
      }),
      expect.objectContaining({
        refId: 'script-failed',
        taskId: 'task-failed',
        targetId: 'script-failed',
      }),
    ])
  })

  it('rejects a single shot execution plan task when the edit script already has a ready plan', async () => {
    prismaMock.projectEditScript.findFirst.mockResolvedValue({
      id: 'script-ready',
      episodeId: 'episode-1',
      chapterId: 'chapter-ready',
      status: 'ready',
      requirements: [],
    })
    prismaMock.projectEditShotExecutionPlan.findFirst.mockResolvedValue({
      id: 'plan-ready',
    })

    await expect(submitProjectEditShotExecutionPlanTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-ready',
      editScriptId: 'script-ready',
      source: 'assistant-panel',
      locale: 'zh',
    })).rejects.toThrow('Shot execution plan is already ready for this edit script.')

    expect(prismaMock.projectEditShotExecutionPlan.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        editScriptId: 'script-ready',
        status: 'ready',
      },
      select: { id: true },
    })
    expect(submitOperationTaskMock).not.toHaveBeenCalled()
    expect(submitOperationTaskBatchMock).not.toHaveBeenCalled()
  })

  it('fails explicitly when no episode edit scripts need shot execution planning', async () => {
    prismaMock.projectEditScript.findMany.mockResolvedValue([
      {
        id: 'script-ready',
        episodeId: 'episode-1',
        chapterId: 'chapter-ready',
        shotExecutionPlan: { status: 'ready' },
      },
    ])

    await expect(submitProjectEditShotExecutionPlanBatchTasks({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      batchKey: 'edit_shot_execution_plan_generate:batch-1',
      source: 'project-agent',
      locale: 'zh',
    })).rejects.toThrow('No edit scripts require shot execution plan generation.')

    expect(submitOperationTaskMock).not.toHaveBeenCalled()
  })
})
