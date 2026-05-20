import { describe, expect, it } from 'vitest'
import {
  mergeWorkspaceProjectListItemUpdate,
  type WorkspaceProjectListItem,
} from '@/lib/projects/workspace-list-item'

describe('workspace project list item', () => {
  it('renaming project with basic PATCH response preserves list stats and cost', () => {
    const current: WorkspaceProjectListItem = {
      id: 'project-1',
      name: '旧项目名',
      description: '旧描述',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      totalCost: 12.5,
      stats: {
        episodes: 2,
        images: 8,
        videos: 3,
        panels: 10,
        firstEpisodePreview: '第一集预览',
      },
    }

    const result = mergeWorkspaceProjectListItemUpdate(current, {
      id: 'project-1',
      name: '新项目名',
      description: '新描述',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    })

    expect(result).toEqual({
      id: 'project-1',
      name: '新项目名',
      description: '新描述',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      totalCost: 12.5,
      stats: {
        episodes: 2,
        images: 8,
        videos: 3,
        panels: 10,
        firstEpisodePreview: '第一集预览',
      },
    })
  })
})
