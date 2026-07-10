import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const bibleMock = vi.hoisted(() => ({
  readEpisodeEditBible: vi.fn(async (): Promise<{
    id: string
    projectId: string
    episodeId: string
    version: number
    status: string
    updatedAt: Date
    stylePreviews: readonly unknown[]
  } | null> => ({
    id: 'bible-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    version: 3,
    status: 'ready_for_review',
    updatedAt: new Date('2026-07-10T00:00:03.000Z'),
    stylePreviews: [],
  })),
  readEpisodeEditChapters: vi.fn(async () => [{
    id: 'chapter-1',
    updatedAt: new Date('2026-07-10T00:00:04.000Z'),
  }]),
}))

const episodeMock = vi.hoisted(() => ({
  readProjectEpisodeDetail: vi.fn(async () => ({
    id: 'episode-1',
    name: 'Episode',
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    storyboards: [{
      id: 'storyboard-1',
      updatedAt: new Date('2026-07-10T00:00:02.000Z'),
    }],
    resourceVersion: {
      scheme: 'aggregate_updated_at' as const,
      value: '2026-07-10T00:00:02.000Z',
    },
  })),
}))

vi.mock('@/lib/edit-bible', () => bibleMock)
vi.mock('@/lib/projects/read-episode-detail', () => episodeMock)

import { materializeWorkspaceResourcesForTask } from '@/lib/workspace-resource/materialized-resource'
import {
  createEditBibleQueryDto,
  createEpisodeDataQueryDto,
} from '@/lib/workspace-resource/query-dto-version'

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
      resourceVersion: {
        scheme: 'revision_updated_at',
        value: { revision: 3, updatedAt: '2026-07-10T00:00:04.000Z' },
      },
      data: expect.objectContaining({
        editBible: expect.objectContaining({
          id: 'bible-1',
          chapters: [expect.objectContaining({ id: 'chapter-1' })],
        }),
        chapters: [expect.objectContaining({ id: 'chapter-1' })],
      }),
    })])
    expect(episodeMock.readProjectEpisodeDetail).not.toHaveBeenCalled()
  })

  it('reads the canonical episodeData Query DTO for media and downstream canvas tasks', async () => {
    const envelopes = await materializeWorkspaceResourcesForTask(task(TASK_TYPE.VIDEO_PANEL))

    expect(envelopes).toEqual([expect.objectContaining({
      kind: 'episodeData',
      taskId: 'task-1',
      resourceVersion: {
        scheme: 'aggregate_updated_at',
        value: '2026-07-10T00:00:02.000Z',
      },
      data: expect.objectContaining({ id: 'episode-1' }),
    })])
    expect(bibleMock.readEpisodeEditBible).not.toHaveBeenCalled()
  })

  it('advances episodeData version when a child row changes without touching the episode', () => {
    const initial = createEpisodeDataQueryDto({
      id: 'episode-1',
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      storyboards: [{
        id: 'storyboard-1',
        updatedAt: new Date('2026-07-10T00:00:01.000Z'),
        panels: [{ id: 'panel-1', updatedAt: new Date('2026-07-10T00:00:02.000Z') }],
      }],
    })
    const childUpdated = createEpisodeDataQueryDto({
      id: 'episode-1',
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      storyboards: [{
        id: 'storyboard-1',
        updatedAt: new Date('2026-07-10T00:00:01.000Z'),
        panels: [{ id: 'panel-1', updatedAt: new Date('2026-07-10T00:00:03.000Z') }],
      }],
    })

    expect(initial.resourceVersion).toEqual({
      scheme: 'aggregate_updated_at',
      value: '2026-07-10T00:00:02.000Z',
    })
    expect(childUpdated.resourceVersion).toEqual({
      scheme: 'aggregate_updated_at',
      value: '2026-07-10T00:00:03.000Z',
    })
  })

  it('advances editBible version when a style preview changes at the same bible revision', () => {
    const initial = createEditBibleQueryDto({
      id: 'bible-1',
      version: 7,
      updatedAt: new Date('2026-07-10T00:00:01.000Z'),
      stylePreviews: [{ id: 'preview-1', updatedAt: new Date('2026-07-10T00:00:02.000Z') }],
    }, [])
    const previewUpdated = createEditBibleQueryDto({
      id: 'bible-1',
      version: 7,
      updatedAt: new Date('2026-07-10T00:00:01.000Z'),
      stylePreviews: [{ id: 'preview-1', updatedAt: new Date('2026-07-10T00:00:03.000Z') }],
    }, [])

    expect(initial.resourceVersion.value).toEqual({
      revision: 7,
      updatedAt: '2026-07-10T00:00:02.000Z',
    })
    expect(previewUpdated.resourceVersion.value).toEqual({
      revision: 7,
      updatedAt: '2026-07-10T00:00:03.000Z',
    })
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
      storyboards: [],
      resourceVersion: null as never,
    })

    await expect(materializeWorkspaceResourcesForTask(task(TASK_TYPE.VIDEO_PANEL)))
      .rejects.toThrow('CANVAS_TERMINAL_RESOURCE_VERSION_MISSING:episodeData:task-1')
  })
})
