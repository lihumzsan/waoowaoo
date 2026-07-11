import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectEditBible: {
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async () => ({
      generationTaskId: 'task-new',
      status: 'generating',
    })),
  },
  projectEditStylePreview: {
    updateMany: vi.fn(async () => ({ count: 0 })),
    findUnique: vi.fn(async () => ({
      taskId: 'task-new',
      status: 'generating',
    })),
  },
  projectVideoGroup: {
    updateMany: vi.fn(async () => ({ count: 0 })),
    findUnique: vi.fn(async () => ({
      taskId: 'task-new',
      status: 'processing',
    })),
  },
  projectEditChapter: {
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async () => ({
      renderTaskId: 'task-new',
      renderStatus: 'processing',
    })),
  },
  projectEpisodeFinalOutput: {
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async () => ({
      renderTaskId: 'task-new',
      renderStatus: 'processing',
    })),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  projectTaskTargetTerminalInTransaction,
} from '@/lib/task/target-failure-sync'

describe('task target failure sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('projects edit bible failure only through the exact generation Task fence', async () => {
    await projectTaskTargetTerminalInTransaction(prismaMock as unknown as Prisma.TransactionClient, {
      kind: 'failed',
      taskId: 'task-1',
      type: TASK_TYPE.EDIT_BIBLE_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
      errorCode: 'MODEL_OUTPUT_SCHEMA_INVALID',
      errorMessage: 'EDIT_BIBLE_EXTRACTION_FAILED',
      errorDetails: { beatSheet: { error: 'stale generation' } },
    })

    expect(prismaMock.projectEditBible.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bible-1',
        generationTaskId: 'task-1',
        status: 'generating',
      },
      data: {
        status: 'failed',
        diagnosticsJson: {
          code: 'MODEL_OUTPUT_SCHEMA_INVALID',
          message: 'EDIT_BIBLE_EXTRACTION_FAILED',
          details: { beatSheet: { error: 'stale generation' } },
        },
      },
    })
  })

  it('fences video group failure by terminal task ownership and active status', async () => {
    await projectTaskTargetTerminalInTransaction(prismaMock as unknown as Prisma.TransactionClient, {
      kind: 'failed',
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

  it.each([
    {
      type: TASK_TYPE.CHAPTER_RENDER,
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
      model: 'projectEditChapter' as const,
      where: {
        id: 'chapter-1',
        renderTaskId: 'task-render',
        renderStatus: 'processing',
      },
    },
    {
      type: TASK_TYPE.FINAL_VIDEO_RENDER,
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
      model: 'projectEpisodeFinalOutput' as const,
      where: {
        episodeId: 'episode-1',
        renderTaskId: 'task-render',
        renderStatus: 'processing',
      },
    },
  ])('projects $type failure only from the unified Task terminal edge', async (fixture) => {
    await projectTaskTargetTerminalInTransaction(prismaMock as unknown as Prisma.TransactionClient, {
      kind: 'failed',
      taskId: 'task-render',
      type: fixture.type,
      targetType: fixture.targetType,
      targetId: fixture.targetId,
      errorCode: 'RENDER_FAILED',
      errorMessage: 'render failed',
    })

    expect(prismaMock[fixture.model].updateMany).toHaveBeenCalledWith({
      where: fixture.where,
      data: { renderStatus: 'failed' },
    })
  })

  it.each([
    {
      type: TASK_TYPE.EDIT_BIBLE_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
      model: 'projectEditBible' as const,
      data: {
        status: 'pending',
        generationTaskId: null,
        diagnosticsJson: expect.anything(),
      },
    },
    {
      type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      targetType: 'ProjectEditStylePreview',
      targetId: 'preview-1',
      model: 'projectEditStylePreview' as const,
      data: { status: 'pending', taskId: null, errorMessage: null },
    },
    {
      type: TASK_TYPE.VIDEO_GROUP,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      model: 'projectVideoGroup' as const,
      data: {
        status: 'pending',
        taskId: null,
        errorCode: null,
        errorMessage: null,
      },
    },
  ])('projects $type cancellation as ownership cleanup, never failure', async (fixture) => {
    const model = prismaMock[fixture.model]
    model.updateMany.mockResolvedValueOnce({ count: 1 })

    await projectTaskTargetTerminalInTransaction(prismaMock as unknown as Prisma.TransactionClient, {
      kind: 'canceled',
      taskId: 'task-1',
      type: fixture.type,
      targetType: fixture.targetType,
      targetId: fixture.targetId,
    })

    expect(model.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: fixture.data }))
    expect(model.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    )
  })

  it('treats an old canceled Task as a no-op after ownership moved', async () => {
    prismaMock.projectEditStylePreview.updateMany.mockResolvedValueOnce({
      count: 0,
    })
    prismaMock.projectEditStylePreview.findUnique.mockResolvedValueOnce({
      taskId: 'task-new',
      status: 'generating',
    })

    await expect(
      projectTaskTargetTerminalInTransaction(prismaMock as unknown as Prisma.TransactionClient, {
        kind: 'canceled',
        taskId: 'task-old',
        type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
        targetType: 'ProjectEditStylePreview',
        targetId: 'preview-1',
      }),
    ).resolves.toBe('stale_owner')
  })

  it('reports success materialization so a late cancel cannot overwrite the winning handler', async () => {
    prismaMock.projectEditStylePreview.updateMany.mockResolvedValueOnce({
      count: 0,
    })
    prismaMock.projectEditStylePreview.findUnique.mockResolvedValueOnce({
      taskId: 'task-1',
      status: 'completed',
    })

    await expect(
      projectTaskTargetTerminalInTransaction(prismaMock as unknown as Prisma.TransactionClient, {
        kind: 'canceled',
        taskId: 'task-1',
        type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
        targetType: 'ProjectEditStylePreview',
        targetId: 'preview-1',
      }),
    ).resolves.toBe('success_materialized')
  })
})
