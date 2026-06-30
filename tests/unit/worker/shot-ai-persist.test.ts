import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
}))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/config-service', () => configServiceMock)

import { resolveAnalysisModel } from '@/lib/workers/handlers/shot-ai-persist'

describe('shot AI analysis model resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.findUnique.mockResolvedValue({ id: 'project-1' })
    configServiceMock.getProjectModelConfig.mockResolvedValue({
      analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
    })
  })

  it('uses shared project model config so platform-key defaults are respected', async () => {
    const result = await resolveAnalysisModel('project-1', 'user-1')

    expect(result).toEqual({
      id: 'project-1',
      analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
    })
    expect(configServiceMock.getProjectModelConfig).toHaveBeenCalledWith('project-1', 'user-1')
    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      select: { id: true },
    })
  })

  it('keeps project existence explicit', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce(null)

    await expect(resolveAnalysisModel('missing-project', 'user-1')).rejects.toThrow('Project not found')
  })

  it('fails explicitly when shared config has no analysis model', async () => {
    configServiceMock.getProjectModelConfig.mockResolvedValueOnce({ analysisModel: null })

    await expect(resolveAnalysisModel('project-1', 'user-1')).rejects.toThrow('请先在项目设置中配置分析模型')
  })
})
