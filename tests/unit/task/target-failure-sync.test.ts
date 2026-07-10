import { beforeEach, describe, expect, it, vi } from 'vitest'
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

import { syncTaskTargetFailure } from '@/lib/task/target-failure-sync'

describe('task target failure sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists final edit bible diagnostics only through the terminal failure sync', async () => {
    const diagnostics = {
      beatSheet: {
        error: 'EDIT_SOURCE_ANCHOR_QUOTE_NOT_FOUND:p0006:startQuote',
      },
    }

    await syncTaskTargetFailure({
      type: TASK_TYPE.EDIT_BIBLE_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
      errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
      errorMessage: 'EDIT_BIBLE_EXTRACTION_FAILED',
      errorDetails: diagnostics,
    })

    expect(prismaMock.projectEditBible.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bible-1',
        status: 'generating',
      },
      data: {
        status: 'failed',
        diagnosticsJson: diagnostics,
      },
    })
  })
})
