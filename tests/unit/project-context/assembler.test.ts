import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  projectEpisode: {
    findUnique: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
  projectEditScreenplay: {
    findFirst: vi.fn(),
  },
  projectEditScript: {
    findFirst: vi.fn(),
  },
}))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/config-service', () => configServiceMock)

const planRunRuntimeMock = vi.hoisted(() => ({
  listPlanRuns: vi.fn(),
  listPlanArtifacts: vi.fn(),
}))

vi.mock('@/lib/plan-run-runtime/service', () => planRunRuntimeMock)

vi.mock('@/lib/project-workflow/edit-first', () => ({
  resolveEditFirstWorkflowState: vi.fn(async () => ({
    active: false,
    stage: 'not_started',
    blocking: {
      kind: 'none',
      reason: null,
    },
    nextAction: null,
    allowedOperationIds: [],
  })),
}))

describe('assembleProjectContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configServiceMock.getProjectModelConfig.mockResolvedValue({
      analysisModel: 'openrouter::platform-analysis',
      videoRatio: '16:9',
    })
  })

  it('includes panel image/video fields in episode detail snapshot', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'project-1',
      name: 'p',
      videoRatio: '16:9',
      artStyle: 'x',
      analysisModel: null,
    })
    prismaMock.projectEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      name: 'e',
      novelText: null,
      storyboards: [
        {
          id: 'storyboard-1',
          editScriptId: null,
          panels: [
            {
              id: 'panel-1',
              panelIndex: 0,
              description: 'd',
              imagePrompt: 'ip',
              videoPrompt: null,
              imageUrl: 'https://img',
              imageMediaId: 'm1',
              candidateImages: '[]',
              videoUrl: 'https://vid',
              videoMediaId: 'vm1',
              updatedAt: new Date('2026-04-20T00:00:00.000Z'),
            },
          ],
        },
      ],
    })
    planRunRuntimeMock.listPlanRuns.mockResolvedValueOnce([])
    planRunRuntimeMock.listPlanRuns.mockResolvedValueOnce([])
    planRunRuntimeMock.listPlanArtifacts.mockResolvedValueOnce([])
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValueOnce(null)
    prismaMock.projectEditScript.findFirst.mockResolvedValueOnce(null)
    prismaMock.task.findMany
      .mockResolvedValueOnce([
        {
          id: 'task-active-1',
          type: 'video_panel',
          status: 'processing',
          targetType: 'ProjectPanel',
          targetId: 'panel-1',
          episodeId: 'episode-1',
          payload: { videoModel: 'google::veo' },
          result: null,
          errorCode: null,
          errorMessage: null,
          operationId: 'generate_panel_video',
          operationSource: 'assistant-panel',
          operationConfirmed: true,
          queuedAt: new Date('2026-04-20T00:01:00.000Z'),
          finishedAt: null,
          updatedAt: new Date('2026-04-20T00:02:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'task-recent-1',
          type: 'music_generate',
          status: 'completed',
          targetType: 'Project',
          targetId: 'project-1',
          episodeId: null,
          payload: { musicModel: 'google::lyria' },
          result: {
            mediaId: 'media-1',
            audioUrl: 'https://cdn.example/music.mp3',
            metadata: {
              largeProviderPayload: 'not exposed',
            },
          },
          errorCode: null,
          errorMessage: null,
          operationId: 'generate_project_music',
          operationSource: 'assistant-confirmation',
          operationConfirmed: true,
          queuedAt: new Date('2026-04-20T00:03:00.000Z'),
          finishedAt: new Date('2026-04-20T00:04:00.000Z'),
          updatedAt: new Date('2026-04-20T00:04:00.000Z'),
        },
      ])

    const mod = await import('@/lib/project-context/assembler')

    const context = await mod.assembleProjectContext({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      selectedScopeRef: null,
    })

    expect(context.episodeDetail?.panels).toEqual([
      {
        panelId: 'panel-1',
        editScriptId: null,
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        description: 'd',
        imagePrompt: 'ip',
        videoPrompt: null,
        imageUrl: 'https://img',
        imageMediaId: 'm1',
        candidateImages: '[]',
        videoUrl: 'https://vid',
        videoMediaId: 'vm1',
        updatedAt: '2026-04-20T00:00:00.000Z',
      },
    ])
    expect(context.activeOperationTasks).toEqual([
      expect.objectContaining({
        operationId: 'generate_panel_video',
        status: 'processing',
        model: 'google::veo',
      }),
    ])
    expect(context.recentOperationResults).toEqual([
      expect.objectContaining({
        operationId: 'generate_project_music',
        status: 'completed',
        media: {
          mediaType: 'music',
          mediaId: 'media-1',
          url: 'https://cdn.example/music.mp3',
        },
      }),
    ])
    expect(JSON.stringify(context.recentOperationResults)).not.toContain('largeProviderPayload')
    expect(context.policy.analysisModel).toBe('openrouter::platform-analysis')
  })
})
