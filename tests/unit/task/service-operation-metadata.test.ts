import { beforeEach, describe, expect, it, vi } from 'vitest'

const taskModelMock = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: taskModelMock,
  },
}))

vi.mock('@/lib/billing', () => ({
  rollbackTaskBilling: vi.fn(),
}))

vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
}))

import { createTask, tryUpdateTaskProgress } from '@/lib/task/service'
import { TASK_TYPE } from '@/lib/task/types'

describe('task service operation metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskModelMock.findFirst.mockResolvedValue(null)
    taskModelMock.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'task-1',
      ...data,
      createdAt: new Date('2026-05-02T00:00:00.000Z'),
      updatedAt: new Date('2026-05-02T00:00:00.000Z'),
    }))
  })

  it('writes operation metadata as first-class task fields', async () => {
    const result = await createTask({
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.MUSIC_GENERATE,
      targetType: 'Project',
      targetId: 'project-1',
      payload: { prompt: 'theme' },
      operationId: 'generate_project_music',
      operationSource: 'assistant-confirmation',
      operationConfirmed: true,
      operationRequestId: 'req-1',
    })

    expect(result.deduped).toBe(false)
    expect(taskModelMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationId: 'generate_project_music',
        operationSource: 'assistant-confirmation',
        operationConfirmed: true,
        operationRequestId: 'req-1',
      }),
    })
  })

  it('merges progress payload without dropping storyboard grid task input', async () => {
    taskModelMock.findFirst.mockResolvedValueOnce({
      payload: {
        panelId: 'panel-1',
        imageModel: 'fal::image-model',
        storyboardGrid: {
          mode: '2x2',
          sourceGenerationSegmentId: 'segment-1',
          panelIds: ['panel-1', 'panel-2', 'panel-3', 'panel-4'],
        },
        meta: {
          locale: 'zh',
          flowId: 'single:image_panel',
        },
        ui: {
          intent: 'generate',
          hasOutputAtStart: true,
        },
      },
    })
    taskModelMock.updateMany.mockResolvedValueOnce({ count: 1 })

    const updated = await tryUpdateTaskProgress('task-1', 18, {
      stage: 'generate_panel_grid',
      meta: {
        locale: 'zh',
      },
    })

    expect(updated).toBe(true)
    expect(taskModelMock.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: { in: ['queued', 'processing'] },
      },
      data: {
        progress: 18,
        payload: {
          panelId: 'panel-1',
          imageModel: 'fal::image-model',
          storyboardGrid: {
            mode: '2x2',
            sourceGenerationSegmentId: 'segment-1',
            panelIds: ['panel-1', 'panel-2', 'panel-3', 'panel-4'],
          },
          stage: 'generate_panel_grid',
          meta: {
            locale: 'zh',
            flowId: 'single:image_panel',
          },
          ui: {
            intent: 'generate',
            hasOutputAtStart: true,
          },
        },
      },
    })
  })
})
