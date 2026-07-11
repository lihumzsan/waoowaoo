import { beforeEach, describe, expect, it, vi } from 'vitest'

const revisionReads = vi.hoisted(() => ({ values: [] as number[] }))
const prismaMock = vi.hoisted(() => ({
  projectEpisode: {
    findFirst: vi.fn(async () => {
      const resourceRevision = revisionReads.values.shift()
      return resourceRevision === undefined ? null : { resourceRevision }
    }),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { readConsistentWorkspaceResourceSnapshot } from '@/lib/workspace-resource/resource-revision'

describe('workspace resource revision snapshot gate', () => {
  beforeEach(() => {
    revisionReads.values = []
    vi.clearAllMocks()
  })

  it('returns a snapshot only when its before and after revisions match', async () => {
    revisionReads.values = [7, 7]
    const read = vi.fn(async () => ({ title: 'stable' }))

    await expect(readConsistentWorkspaceResourceSnapshot({
      projectId: 'project-1',
      episodeId: 'episode-1',
      read,
    })).resolves.toEqual({
      data: { title: 'stable' },
      resourceRevision: 7,
    })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('restarts the whole read when a child mutation advances the revision', async () => {
    revisionReads.values = [7, 8, 8, 8]
    const read = vi.fn()
      .mockResolvedValueOnce({ title: 'racy' })
      .mockResolvedValueOnce({ title: 'stable' })

    await expect(readConsistentWorkspaceResourceSnapshot({
      projectId: 'project-1',
      episodeId: 'episode-1',
      read,
    })).resolves.toEqual({
      data: { title: 'stable' },
      resourceRevision: 8,
    })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('fails explicitly when three full reads cannot obtain a stable revision', async () => {
    revisionReads.values = [1, 2, 2, 3, 3, 4]

    await expect(readConsistentWorkspaceResourceSnapshot({
      projectId: 'project-1',
      episodeId: 'episode-1',
      read: async () => ({ title: 'changing' }),
    })).rejects.toThrow('WORKSPACE_RESOURCE_SNAPSHOT_CHANGED_DURING_READ:episode-1')
  })
})
