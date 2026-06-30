import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  projectEpisode: {
    findUnique: vi.fn(),
  },
  projectStoryboard: {
    count: vi.fn(),
  },
  projectPanel: {
    count: vi.fn(),
  },
  planApproval: {
    findMany: vi.fn(),
  },
}))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(),
}))

const planRunRuntimeMock = vi.hoisted(() => ({
  listPlanRuns: vi.fn(),
  listPlanArtifacts: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/config-service', () => configServiceMock)

vi.mock('@/lib/plan-run-runtime/service', () => planRunRuntimeMock)

describe('assembleProjectProjectionLite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      name: 'Project',
      videoRatio: '16:9',
    })
    prismaMock.projectStoryboard.count.mockResolvedValue(0)
    prismaMock.projectPanel.count.mockResolvedValue(0)
    prismaMock.planApproval.findMany.mockResolvedValue([])
    planRunRuntimeMock.listPlanRuns.mockResolvedValue([])
    planRunRuntimeMock.listPlanArtifacts.mockResolvedValue([])
    configServiceMock.getProjectModelConfig.mockResolvedValue({
      analysisModel: 'openrouter::platform-analysis',
      videoRatio: '9:16',
    })
  })

  it('uses shared project model config for policy model fields', async () => {
    const { assembleProjectProjectionLite } = await import('@/lib/project-projection/lite')

    const projection = await assembleProjectProjectionLite({
      projectId: 'project-1',
      userId: 'user-1',
    })

    expect(projection.policy.analysisModel).toBe('openrouter::platform-analysis')
    expect(projection.policy.videoRatio).toBe('9:16')
    expect(configServiceMock.getProjectModelConfig).toHaveBeenCalledWith('project-1', 'user-1')
  })
})
