import { beforeEach, describe, expect, it, vi } from 'vitest'

const taskModelMock = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: taskModelMock,
    $transaction: vi.fn(async (run: (tx: { task: typeof taskModelMock }) => Promise<unknown>) =>
      await run({ task: taskModelMock })),
  },
}))

import { tryClaimTaskAttempt, tryUpdateTaskProgress } from '@/lib/task/service'

describe('task service operation metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    taskModelMock.findFirst.mockResolvedValue(null)
  })

  it('merges progress payload without dropping panel image task input', async () => {
    taskModelMock.findFirst.mockResolvedValueOnce({
      payload: {
        panelId: 'panel-1',
        imageModel: 'fal::image-model',
        referenceMode: 'asset',
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

    const updated = await tryUpdateTaskProgress('task-1', 2, 18, {
      stage: 'generate_panel_image',
      meta: {
        locale: 'zh',
      },
    })

    expect(updated).toBe(true)
    expect(taskModelMock.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        status: 'processing',
        attempt: 2,
      },
      data: {
        progress: 18,
        payload: {
          panelId: 'panel-1',
          imageModel: 'fal::image-model',
          referenceMode: 'asset',
          stage: 'generate_panel_image',
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

  it('claims exactly one queued attempt without clearing its externalId', async () => {
    taskModelMock.updateMany.mockResolvedValueOnce({ count: 1 })
    taskModelMock.findUnique.mockResolvedValueOnce({ status: 'processing', attempt: 2 })

    const marked = await tryClaimTaskAttempt({ taskId: 'task-1' })

    expect(marked).toBe(2)
    const call = taskModelMock.updateMany.mock.calls[0]?.[0] as {
      data?: Record<string, unknown>
      where?: Record<string, unknown>
    } | undefined
    expect(call?.where).toEqual({
      id: 'task-1',
      status: 'queued',
    })
    expect(call?.data).toEqual(expect.objectContaining({
      status: 'processing',
      attempt: { increment: 1 },
    }))
    expect(Object.prototype.hasOwnProperty.call(call?.data || {}, 'externalId')).toBe(false)
  })

  it('updates externalId only when a new external id is explicitly provided', async () => {
    taskModelMock.updateMany.mockResolvedValueOnce({ count: 1 })
    taskModelMock.findUnique.mockResolvedValueOnce({ status: 'processing', attempt: 1 })

    const marked = await tryClaimTaskAttempt({
      taskId: 'task-1',
      externalId: 'FAL:VIDEO:endpoint:req-1',
    })

    expect(marked).toBe(1)
    const call = taskModelMock.updateMany.mock.calls[0]?.[0] as {
      data?: Record<string, unknown>
    } | undefined
    expect(call?.data).toEqual(expect.objectContaining({
      externalId: 'FAL:VIDEO:endpoint:req-1',
    }))
  })
})
