import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectVideoGroup: {
    findMany: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { assertChapterReplanHasNoRunningVideoGroups } from '@/lib/edit-script/replan-guard'

describe('edit script replan guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks chapter replan when a video group is processing', async () => {
    prismaMock.projectVideoGroup.findMany.mockResolvedValueOnce([
      { id: 'group-1', status: 'processing' },
    ])

    await expect(assertChapterReplanHasNoRunningVideoGroups({
      projectId: 'project-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
    })).rejects.toThrow('EDIT_SCRIPT_REPLAN_VIDEO_GROUP_RUNNING:group-1:processing')
  })

  it('blocks chapter replan when a submitted group task is still active', async () => {
    prismaMock.projectVideoGroup.findMany.mockResolvedValueOnce([
      { id: 'group-1', status: 'pending' },
    ])
    prismaMock.task.findFirst.mockResolvedValueOnce({
      targetId: 'group-1',
      status: 'queued',
    })

    await expect(assertChapterReplanHasNoRunningVideoGroups({
      projectId: 'project-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
    })).rejects.toThrow('EDIT_SCRIPT_REPLAN_VIDEO_GROUP_TASK_RUNNING:group-1:queued')
  })

  it('allows chapter replan when no video group work is active', async () => {
    prismaMock.projectVideoGroup.findMany.mockResolvedValueOnce([
      { id: 'group-1', status: 'failed' },
      { id: 'group-2', status: 'completed' },
    ])
    prismaMock.task.findFirst.mockResolvedValueOnce(null)

    await expect(assertChapterReplanHasNoRunningVideoGroups({
      projectId: 'project-1',
      episodeId: 'episode-1',
      chapterId: 'chapter-1',
    })).resolves.toBeUndefined()
  })
})
