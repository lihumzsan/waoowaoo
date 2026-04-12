import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}))

const queuesMock = vi.hoisted(() => ({
  addTaskJob: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/queues', () => queuesMock)
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}))

import { recoverTasksOnWorkerStartup } from '@/lib/task/startup-recovery'

describe('task startup recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('aborts local ComfyUI queued and processing tasks instead of recovering them', async () => {
    prismaMock.task.findMany
      .mockResolvedValueOnce([
        {
          id: 'processing-comfy',
          type: 'video_panel',
          payload: { videoModel: 'comfyui::basevideo/图生视频/ltx2.3-图生视频-没字幕版' },
          billingInfo: null,
        },
        {
          id: 'processing-cloud',
          type: 'video_panel',
          payload: { videoModel: 'vidu::vidu-q1' },
          billingInfo: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'queued-comfy',
          userId: 'user-1',
          projectId: 'project-1',
          episodeId: null,
          type: 'video_panel',
          targetType: 'NovelPromotionPanel',
          targetId: 'panel-1',
          payload: { videoModel: 'comfyui::basevideo/图生视频/ltx2.3-图生视频-没字幕版', meta: { locale: 'zh' } },
          billingInfo: null,
          priority: 0,
        },
        {
          id: 'queued-cloud',
          userId: 'user-1',
          projectId: 'project-1',
          episodeId: null,
          type: 'video_panel',
          targetType: 'NovelPromotionPanel',
          targetId: 'panel-2',
          payload: { videoModel: 'vidu::vidu-q1', meta: { locale: 'zh' } },
          billingInfo: null,
          priority: 0,
        },
      ])
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.task.update.mockResolvedValue({})
    queuesMock.addTaskJob.mockResolvedValue(undefined)

    await recoverTasksOnWorkerStartup()

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'processing-comfy',
      }),
      data: expect.objectContaining({
        status: 'canceled',
        errorCode: 'APP_RESTARTED_LOCAL_COMFYUI_TASK_ABORTED',
      }),
    }))
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'queued-comfy',
      }),
      data: expect.objectContaining({
        status: 'canceled',
        errorCode: 'APP_RESTARTED_LOCAL_COMFYUI_TASK_ABORTED',
      }),
    }))
    expect(queuesMock.addTaskJob).toHaveBeenCalledTimes(1)
    expect(queuesMock.addTaskJob).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'queued-cloud',
    }), {
      priority: 0,
    })
  })
})
