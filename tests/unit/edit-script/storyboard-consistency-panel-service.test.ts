import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectStoryboard: {
    findMany: vi.fn(),
  },
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn(),
}))

const sourceSnapshotMock = vi.hoisted(() => ({
  buildStoryboardConsistencySource: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/edit-script/storyboard-consistency/source-snapshot', () => sourceSnapshotMock)

import { submitEditScriptStoryboardPanels } from '@/lib/edit-script/storyboard-consistency/service'

describe('edit-script storyboard panel service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEditScript.findFirst.mockResolvedValue({ id: 'edit-1' })
    prismaMock.projectStoryboard.findMany.mockResolvedValue([])
  })

  it('reports missing storyboard spatial blocking instead of missing location profiles', async () => {
    await expect(submitEditScriptStoryboardPanels({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      userId: 'user-1',
      locale: 'zh',
    })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'CONFLICT',
      details: {
        code: 'STORYBOARD_SPATIAL_BLOCKING_REQUIRED',
        message: 'Ready storyboard spatial blocking is required before generating storyboard panels',
      },
    })

    expect(sourceSnapshotMock.buildStoryboardConsistencySource).not.toHaveBeenCalled()
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })
})
