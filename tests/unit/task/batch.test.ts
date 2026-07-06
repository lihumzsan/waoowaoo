import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { createTaskBatchKey, listTaskBatchFailures, readLatestFailedTaskBatchKeyForTarget, readTaskBatchStatus } from '@/lib/task/batch'

describe('task batch helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates namespaced batch keys', () => {
    const batchKey = createTaskBatchKey('plan_chapters')

    expect(batchKey.startsWith('plan_chapters:')).toBe(true)
    expect(batchKey.length).toBeGreaterThan('plan_chapters:'.length)
  })

  it('fails explicitly when the prefix is empty', () => {
    expect(() => createTaskBatchKey('   ')).toThrow('TASK_BATCH_PREFIX_REQUIRED')
  })

  it('reads settled status and failed count from tasks with the same batchKey', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([
      {
        id: 'task-1',
        type: 'edit_script_generate',
        status: 'completed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-1',
        errorCode: null,
        errorMessage: null,
      },
      {
        id: 'task-2',
        type: 'edit_script_generate',
        status: 'failed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-2',
        errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
        errorMessage: 'bad output',
      },
      {
        id: 'task-3',
        type: 'edit_script_generate',
        status: 'completed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-3',
        errorCode: null,
        errorMessage: null,
      },
    ])

    await expect(readTaskBatchStatus('plan_chapters:batch-1')).resolves.toEqual({
      batchKey: 'plan_chapters:batch-1',
      total: 3,
      terminal: 3,
      failed: 1,
      settled: true,
    })
  })

  it('counts only the latest task for a retried batch target', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([
      {
        id: 'task-1',
        type: 'edit_script_generate',
        status: 'failed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-1',
        errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
        errorMessage: 'bad output',
      },
      {
        id: 'task-2',
        type: 'edit_script_generate',
        status: 'completed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-1',
        errorCode: null,
        errorMessage: null,
      },
      {
        id: 'task-3',
        type: 'edit_script_generate',
        status: 'completed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-2',
        errorCode: null,
        errorMessage: null,
      },
    ])

    await expect(readTaskBatchStatus('plan_chapters:batch-1')).resolves.toEqual({
      batchKey: 'plan_chapters:batch-1',
      total: 2,
      terminal: 2,
      failed: 0,
      settled: true,
    })
  })

  it('lists only current failed tasks in a batch', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([
      {
        id: 'task-old',
        type: 'edit_script_generate',
        status: 'failed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-1',
        errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
        errorMessage: 'old output',
      },
      {
        id: 'task-new',
        type: 'edit_script_generate',
        status: 'completed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-1',
        errorCode: null,
        errorMessage: null,
      },
      {
        id: 'task-2',
        type: 'edit_script_generate',
        status: 'failed',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-2',
        errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
        errorMessage: 'bad output',
      },
    ])

    await expect(listTaskBatchFailures('plan_chapters:batch-1')).resolves.toEqual([{
      id: 'task-2',
      type: 'edit_script_generate',
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-2',
      errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
      errorMessage: 'bad output',
    }])
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        batchKey: 'plan_chapters:batch-1',
      }),
    }))
  })

  it('reads the latest failed batch key for a task target', async () => {
    prismaMock.task.findFirst.mockResolvedValueOnce({
      batchKey: 'plan_chapters:batch-1',
    })

    await expect(readLatestFailedTaskBatchKeyForTarget({
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: 'edit_script_generate',
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
    })).resolves.toBe('plan_chapters:batch-1')

    expect(prismaMock.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        projectId: 'project-1',
        episodeId: 'episode-1',
        type: 'edit_script_generate',
        targetType: 'ProjectEditChapter',
        targetId: 'chapter-1',
        batchKey: { not: null },
        status: { in: ['failed', 'canceled', 'dismissed'] },
      }),
    }))
  })
})
