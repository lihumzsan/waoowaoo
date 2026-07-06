import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { createTaskBatchKey, listTaskBatchFailures, readTaskBatchStatus } from '@/lib/task/batch'

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
    prismaMock.task.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)

    await expect(readTaskBatchStatus('plan_chapters:batch-1')).resolves.toEqual({
      batchKey: 'plan_chapters:batch-1',
      total: 3,
      terminal: 3,
      failed: 1,
      settled: true,
    })
  })

  it('lists failed tasks in a batch', async () => {
    prismaMock.task.findMany.mockResolvedValueOnce([{
      id: 'task-1',
      type: 'edit_script_generate',
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
      errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
      errorMessage: 'bad output',
    }])

    await expect(listTaskBatchFailures('plan_chapters:batch-1')).resolves.toEqual([{
      id: 'task-1',
      type: 'edit_script_generate',
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
      errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
      errorMessage: 'bad output',
    }])
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        batchKey: 'plan_chapters:batch-1',
        status: 'failed',
      }),
    }))
  })
})
