import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectEditBible: {
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  projectEditStylePreview: {
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  projectVideoGroup: {
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { syncTaskTargetFailureInTransaction } from '@/lib/task/target-failure-sync'

describe('task target failure sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not project edit bible failure without a resource task ownership fence', async () => {
    await syncTaskTargetFailureInTransaction(prismaMock as unknown as Prisma.TransactionClient, {
      taskId: 'task-1',
      type: TASK_TYPE.EDIT_BIBLE_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
      errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
      errorMessage: 'EDIT_BIBLE_EXTRACTION_FAILED',
      errorDetails: { beatSheet: { error: 'stale generation' } },
    })

    expect(prismaMock.projectEditBible.updateMany).not.toHaveBeenCalled()
  })

  it('fences video group failure by terminal task ownership and active status', async () => {
    await syncTaskTargetFailureInTransaction(prismaMock as unknown as Prisma.TransactionClient, {
      taskId: 'task-2',
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      errorCode: 'PROVIDER_FAILED',
      errorMessage: 'generation failed',
    })

    expect(prismaMock.projectVideoGroup.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'group-1',
        taskId: 'task-2',
        status: { in: ['pending', 'generating', 'processing'] },
      },
      data: {
        status: 'failed',
        taskId: null,
        errorCode: 'PROVIDER_FAILED',
        errorMessage: 'generation failed',
      },
    })
  })
})
