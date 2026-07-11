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
      scheme: 'resource_revision' as const,
      value: 12,
    },
  })),
}))

const revisionMock = vi.hoisted(() => ({
  readConsistentWorkspaceResourceSnapshot: vi.fn(async <T>(input: { read: () => Promise<T> }) => ({
    data: await input.read(),
    resourceRevision: 12,
  })),
}))

vi.mock('@/lib/edit-bible', () => bibleMock)
vi.mock('@/lib/projects/read-episode-detail', () => episodeMock)
vi.mock('@/lib/workspace-resource/resource-revision', () => revisionMock)

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
        scheme: 'resource_revision',
        value: 12,
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
        scheme: 'resource_revision',
        value: 12,
      },
      data: expect.objectContaining({ id: 'episode-1' }),
    })])
    expect(bibleMock.readEpisodeEditBible).not.toHaveBeenCalled()
  })

  it('uses the database-owned episode resource revision instead of timestamps', () => {
    const initial = createEpisodeDataQueryDto({
      id: 'episode-1',
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      storyboards: [{
        id: 'storyboard-1',
        updatedAt: new Date('2026-07-10T00:00:01.000Z'),
        panels: [{ id: 'panel-1', updatedAt: new Date('2026-07-10T00:00:02.000Z') }],
      }],
    }, 12)
    const childUpdated = createEpisodeDataQueryDto({
      id: 'episode-1',
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      storyboards: [{
        id: 'storyboard-1',
        updatedAt: new Date('2026-07-10T00:00:01.000Z'),
        panels: [{ id: 'panel-1', updatedAt: new Date('2026-07-10T00:00:03.000Z') }],
      }],
    }, 13)

    expect(initial.resourceVersion).toEqual({
      scheme: 'resource_revision',
      value: 12,
    })
    expect(childUpdated.resourceVersion).toEqual({
      scheme: 'resource_revision',
      value: 13,
    })
  })

  it('uses the same database-owned resource revision for editBible snapshots', () => {
    const initial = createEditBibleQueryDto({
      id: 'bible-1',
      version: 7,
      updatedAt: new Date('2026-07-10T00:00:01.000Z'),
      stylePreviews: [{ id: 'preview-1', updatedAt: new Date('2026-07-10T00:00:02.000Z') }],
    }, [], 12)
    const previewUpdated = createEditBibleQueryDto({
      id: 'bible-1',
      version: 7,
      updatedAt: new Date('2026-07-10T00:00:01.000Z'),
      stylePreviews: [{ id: 'preview-1', updatedAt: new Date('2026-07-10T00:00:03.000Z') }],
    }, [], 13)

    expect(initial.resourceVersion.value).toBe(12)
    expect(previewUpdated.resourceVersion.value).toBe(13)
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
