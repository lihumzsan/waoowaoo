import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectPanel: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

const liteMock = vi.hoisted(() => ({
  assembleProjectProjectionLite: vi.fn(),
}))

vi.mock('@/lib/project-projection/lite', () => liteMock)

import { assembleProjectProjectionFull } from '@/lib/project-projection/full'

describe('assembleProjectProjectionFull', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('[episode present] -> returns panels with image/video fields and truncation flag', async () => {
    liteMock.assembleProjectProjectionLite.mockResolvedValueOnce({
      projectId: 'project-1',
      projectName: 'p',
      episodeId: 'episode-1',
      episodeName: 'e',
      selectedScopeRef: null,
      policy: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        videoRatio: '16:9',
        artStyle: 'x',
        analysisModel: null,
        overrides: {},
      },
      progress: {
        storyboardCount: 1,
        panelCount: 5,
      },
      activePlanRuns: [],
      latestArtifacts: [],
    })

    prismaMock.projectPanel.count.mockResolvedValueOnce(5)
    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      {
        id: 'panel-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        panelNumber: 1,
        shotType: null,
        cameraMove: null,
        description: 'd',
        location: null,
        characters: null,
        props: null,
        duration: 1,
        imagePrompt: 'ip',
        videoPrompt: null,
        imageUrl: 'https://img',
        imageMediaId: 'm1',
        candidateImages: '[]',
        videoUrl: 'https://vid',
        lastVideoGenerationOptions: { resolution: '720p', duration: 8 },
        videoMediaId: 'vm1',
        createdAt: new Date('2026-04-20T00:00:00.000Z'),
        updatedAt: new Date('2026-04-20T00:00:00.000Z'),
        storyboard: {
          editScriptId: 'edit-script-1',
        },
      },
    ])

    const result = await assembleProjectProjectionFull({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      panelLimit: 1,
    })

    expect(result.episodeDetail?.panels).toEqual([
      expect.objectContaining({
        panelId: 'panel-1',
        editScriptId: 'edit-script-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        imagePrompt: 'ip',
        videoPrompt: null,
        imageUrl: 'https://img',
        imageMediaId: 'm1',
        candidateImages: '[]',
        videoUrl: 'https://vid',
        lastVideoGenerationOptions: { resolution: '720p', duration: 8 },
        videoMediaId: 'vm1',
      }),
    ])
    expect(result.episodeDetail?.panelLimit).toBe(1)
    expect(result.episodeDetail?.totalPanelCount).toBe(5)
    expect(result.episodeDetail?.truncated).toBe(true)
  })

  it('[no episode] -> episode detail null', async () => {
    liteMock.assembleProjectProjectionLite.mockResolvedValueOnce({
      projectId: 'project-1',
      projectName: 'p',
      episodeId: null,
      episodeName: null,
      selectedScopeRef: null,
      policy: {
        projectId: 'project-1',
        episodeId: null,
        videoRatio: '16:9',
        artStyle: 'x',
        analysisModel: null,
        overrides: {},
      },
      progress: {
        storyboardCount: 0,
        panelCount: 0,
      },
      activePlanRuns: [],
      latestArtifacts: [],
    })

    const result = await assembleProjectProjectionFull({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: null,
    })

    expect(result.episodeDetail).toBeNull()
    expect(prismaMock.projectPanel.findMany).not.toHaveBeenCalled()
  })

  it('[scope panelId] -> restricts panel query and is not truncated', async () => {
    liteMock.assembleProjectProjectionLite.mockResolvedValueOnce({
      projectId: 'project-1',
      projectName: 'p',
      episodeId: 'episode-1',
      episodeName: 'e',
      selectedScopeRef: null,
      policy: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        videoRatio: '16:9',
        artStyle: 'x',
        analysisModel: null,
        overrides: {},
      },
      progress: {
        storyboardCount: 1,
        panelCount: 1,
      },
      activePlanRuns: [],
      latestArtifacts: [],
    })

    prismaMock.projectPanel.count.mockResolvedValueOnce(1)
    prismaMock.projectPanel.findMany.mockResolvedValueOnce([
      {
        id: 'panel-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        panelNumber: 1,
        shotType: null,
        cameraMove: null,
        description: 'd',
        location: null,
        characters: null,
        props: null,
        duration: 1,
        imagePrompt: 'ip',
        videoPrompt: null,
        imageUrl: null,
        imageMediaId: null,
        candidateImages: null,
        videoUrl: null,
        lastVideoGenerationOptions: null,
        videoMediaId: null,
        createdAt: new Date('2026-04-20T00:00:00.000Z'),
        updatedAt: new Date('2026-04-20T00:00:00.000Z'),
        storyboard: {
          editScriptId: 'edit-script-1',
        },
      },
    ])

    const result = await assembleProjectProjectionFull({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      panelLimit: 10,
      scope: { panelId: 'panel-1' },
    })

    expect(prismaMock.projectPanel.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ storyboard: { episodeId: 'episode-1' } }, { id: 'panel-1' }] },
    }))
    expect(result.episodeDetail?.totalPanelCount).toBe(1)
    expect(result.episodeDetail?.truncated).toBe(false)
  })
})
