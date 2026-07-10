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

  it('supports source-script failure and builds explicit fallback diagnostics', async () => {
    await syncTaskTargetFailure({
      type: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE,
      targetType: 'ProjectEditSourceScript',
      targetId: 'bible-source-1',
      errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
      errorMessage: 'source extraction failed',
    })

    expect(prismaMock.projectEditBible.updateMany).toHaveBeenCalledWith({
      where: { id: 'bible-source-1', status: 'generating' },
      data: {
        status: 'failed',
        diagnosticsJson: { error: 'source extraction failed' },
      },
    })
  })

  it('requires both the task type and target type for every failure projection', async () => {
    const mismatches = [
      { type: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE, targetType: 'WrongTarget' },
      { type: TASK_TYPE.IMAGE_CHARACTER, targetType: 'ProjectEditSourceScript' },
      { type: TASK_TYPE.EDIT_BIBLE_GENERATE, targetType: 'WrongTarget' },
      { type: TASK_TYPE.IMAGE_CHARACTER, targetType: 'ProjectEditBible' },
      { type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE, targetType: 'WrongTarget' },
      { type: TASK_TYPE.IMAGE_CHARACTER, targetType: 'ProjectEditStylePreview' },
      { type: TASK_TYPE.VIDEO_GROUP, targetType: 'WrongTarget' },
      { type: TASK_TYPE.IMAGE_CHARACTER, targetType: 'ProjectVideoGroup' },
    ]
    for (const mismatch of mismatches) {
      await syncTaskTargetFailure({
        ...mismatch,
        targetId: 'target-mismatch',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'must not project',
      })
    }

    expect(prismaMock.projectEditBible.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.projectEditStylePreview.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.projectVideoGroup.updateMany).not.toHaveBeenCalled()
  })

  it('projects style preview and video group failures with bounded diagnostics', async () => {
    const longMessage = `prefix-${'x'.repeat(2200)}`
    const longErrorCode = 'PROVIDER_FAILURE_CODE_LONGER_THAN_EIGHTY_CHARACTERS_ABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890'
    await syncTaskTargetFailure({
      type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      targetType: 'ProjectEditStylePreview',
      targetId: 'preview-1',
      errorCode: 'EXTERNAL_ERROR',
      errorMessage: longMessage,
    })
    await syncTaskTargetFailure({
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'video-group-1',
      errorCode: longErrorCode,
      errorMessage: longMessage,
      errorDetails: { provider: 'fal' },
    })

    expect(prismaMock.projectEditStylePreview.updateMany).toHaveBeenCalledWith({
      where: { id: 'preview-1', status: { in: ['pending', 'generating'] } },
      data: { status: 'failed', errorMessage: longMessage.slice(0, 2000) },
    })
    expect(prismaMock.projectVideoGroup.updateMany).toHaveBeenCalledWith({
      where: { id: 'video-group-1' },
      data: {
        status: 'failed',
        taskId: null,
        errorCode: longErrorCode.slice(0, 80),
        errorMessage: longMessage.slice(0, 2000),
      },
    })
  })
})
