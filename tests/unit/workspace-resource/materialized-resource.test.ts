import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const bibleMock = vi.hoisted(() => ({
  readEpisodeEditBible: vi.fn(async (): Promise<{
    id: string
    projectId: string
    episodeId: string
    version: number
    status: string
  } | null> => ({
    id: 'bible-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    version: 3,
    status: 'ready_for_review',
  })),
  readEpisodeEditChapters: vi.fn(async () => [{ id: 'chapter-1' }]),
}))

const episodeMock = vi.hoisted(() => ({
  readProjectEpisodeDetail: vi.fn(async () => ({
    id: 'episode-1',
    name: 'Episode',
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
  })),
}))

vi.mock('@/lib/edit-bible', () => bibleMock)
vi.mock('@/lib/projects/read-episode-detail', () => episodeMock)

import { materializeWorkspaceResourcesForTask } from '@/lib/workspace-resource/materialized-resource'

function task(type: TaskJobData['type']): TaskJobData {
  return {
    taskId: 'task-1',
    type,
    locale: 'zh',
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'ProjectEpisode',
    targetId: 'episode-1',
    userId: 'user-1',
  }
}

describe('workspace terminal resource materialization', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the exact editBible Query DTO after source script persistence', async () => {
    const envelopes = await materializeWorkspaceResourcesForTask(task(TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE))

    expect(envelopes).toEqual([expect.objectContaining({
      kind: 'editBible',
      taskId: 'task-1',
      resourceKey: 'editBible:project-1:episode-1',
      resourceVersion: { scheme: 'revision', value: 3 },
      data: {
        editBible: expect.objectContaining({ id: 'bible-1', chapters: [{ id: 'chapter-1' }] }),
        chapters: [{ id: 'chapter-1' }],
      },
    })])
    expect(episodeMock.readProjectEpisodeDetail).not.toHaveBeenCalled()
  })

  it('reads the canonical episodeData Query DTO for media and downstream canvas tasks', async () => {
    const envelopes = await materializeWorkspaceResourcesForTask(task(TASK_TYPE.VIDEO_PANEL))

    expect(envelopes).toEqual([expect.objectContaining({
      kind: 'episodeData',
      taskId: 'task-1',
      resourceVersion: {
        scheme: 'updated_at',
        value: '2026-07-10T00:00:00.000Z',
      },
      data: expect.objectContaining({ id: 'episode-1' }),
    })])
    expect(bibleMock.readEpisodeEditBible).not.toHaveBeenCalled()
  })

  it('fails explicitly when a required editBible resource is absent', async () => {
    bibleMock.readEpisodeEditBible.mockResolvedValueOnce(null)

    await expect(materializeWorkspaceResourcesForTask(task(TASK_TYPE.EDIT_BIBLE_GENERATE)))
      .rejects.toThrow('CANVAS_TERMINAL_RESOURCE_HANDOFF_MISSING:editBible:task-1')
  })

  it('fails explicitly instead of using task identity when episodeData has no comparable version', async () => {
    episodeMock.readProjectEpisodeDetail.mockResolvedValueOnce({
      id: 'episode-1',
      name: 'Episode without version',
      updatedAt: null as unknown as Date,
    })

    await expect(materializeWorkspaceResourcesForTask(task(TASK_TYPE.VIDEO_PANEL)))
      .rejects.toThrow('CANVAS_TERMINAL_RESOURCE_VERSION_MISSING:episodeData:task-1')
  })
})
