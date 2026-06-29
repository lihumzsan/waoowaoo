import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  projectVideoGroup: {
    updateMany: vi.fn(),
  },
  projectEditAssetRequirement: {
    updateMany: vi.fn(),
  },
  locationImage: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))
vi.mock('@/lib/billing', () => ({
  rollbackTaskBilling: vi.fn(),
}))

import { tryMarkTaskFailed } from '@/lib/task/service'

describe('task failure target sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-location-1',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      targetType: 'LocationImage',
      targetId: 'location-1',
    })
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.projectEditAssetRequirement.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.locationImage.findUnique.mockResolvedValue(null)
  })

  it('marks edit location requirement failed when an image task is marked failed', async () => {
    await expect(tryMarkTaskFailed(
      'task-location-1',
      'INTERNAL_ERROR',
      'AI_PROVIDER_MODALITY_UNSUPPORTED:codex:vision',
    )).resolves.toBe(true)

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-location-1',
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      data: expect.objectContaining({
        status: TASK_STATUS.FAILED,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'AI_PROVIDER_MODALITY_UNSUPPORTED:codex:vision',
      }),
    })
    expect(prismaMock.projectEditAssetRequirement.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        kind: 'location',
        targetId: { in: ['location-1'] },
        status: { not: 'completed' },
      },
      data: {
        status: 'failed',
        errorMessage: 'AI_PROVIDER_MODALITY_UNSUPPORTED:codex:vision',
      },
    })
  })
})
