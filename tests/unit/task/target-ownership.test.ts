import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import { TASK_TYPE } from '@/lib/task/types'

const txMock = vi.hoisted(() => ({
  projectEditChapter: {
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  projectEpisode: {
    findFirst: vi.fn(async () => ({ id: 'episode-1' })),
  },
  projectEpisodeFinalOutput: {
    updateMany: vi.fn(async () => ({ count: 1 })),
    create: vi.fn(async () => ({})),
  },
}))

import { claimTaskTargetOwnershipInTransaction } from '@/lib/task/target-ownership'

describe('Task submission target ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    txMock.projectEditChapter.updateMany.mockResolvedValue({ count: 1 })
    txMock.projectEpisode.findFirst.mockResolvedValue({ id: 'episode-1' })
    txMock.projectEpisodeFinalOutput.updateMany.mockResolvedValue({ count: 1 })
  })

  it('claims a chapter render target before the Task created event can be published', async () => {
    await claimTaskTargetOwnershipInTransaction(txMock as unknown as Prisma.TransactionClient, {
      id: 'task-chapter-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.CHAPTER_RENDER,
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
    })

    expect(txMock.projectEditChapter.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'chapter-1',
        episodeId: 'episode-1',
        episode: { projectId: 'project-1' },
      },
      data: { renderTaskId: 'task-chapter-1', renderStatus: 'processing' },
    })
  })

  it('claims or creates the final-render target in the same submission transaction', async () => {
    txMock.projectEpisodeFinalOutput.updateMany.mockResolvedValueOnce({ count: 0 })

    await claimTaskTargetOwnershipInTransaction(txMock as unknown as Prisma.TransactionClient, {
      id: 'task-final-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.FINAL_VIDEO_RENDER,
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
    })

    expect(txMock.projectEpisode.findFirst).toHaveBeenCalledWith({
      where: { id: 'episode-1', projectId: 'project-1' },
      select: { id: true },
    })
    expect(txMock.projectEpisodeFinalOutput.create).toHaveBeenCalledWith({
      data: {
        episodeId: 'episode-1',
        renderTaskId: 'task-final-1',
        renderStatus: 'processing',
      },
    })
  })

  it('rejects a render Task whose declared target cannot own it', async () => {
    await expect(claimTaskTargetOwnershipInTransaction(txMock as unknown as Prisma.TransactionClient, {
      id: 'task-final-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.FINAL_VIDEO_RENDER,
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
    })).rejects.toThrow('FINAL_VIDEO_RENDER_SUBMISSION_TARGET_INVALID')
  })
})
