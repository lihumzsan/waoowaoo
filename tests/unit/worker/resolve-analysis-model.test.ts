import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
  },
}))

const apiConfigMock = vi.hoisted(() => ({
  getModelsByType: vi.fn(),
  getProviderKey: vi.fn((providerId?: string) => {
    if (!providerId) return ''
    const colonIndex = providerId.indexOf(':')
    return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex)
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/api-config', () => apiConfigMock)

import { resolveAnalysisModel } from '@/lib/workers/handlers/resolve-analysis-model'

describe('resolveAnalysisModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiConfigMock.getModelsByType.mockResolvedValue([
      {
        modelKey: 'openai-compatible:project::gpt-4.1',
        provider: 'openai-compatible:project',
      },
      {
        modelKey: 'openai-compatible:pref::gpt-4.1-mini',
        provider: 'openai-compatible:pref',
      },
    ])
    prismaMock.userPreference.findUnique.mockResolvedValue({
      analysisModel: 'openai-compatible:pref::gpt-4.1-mini',
    })
  })

  it('uses inputModel override when it is enabled', async () => {
    apiConfigMock.getModelsByType.mockResolvedValueOnce([
      {
        modelKey: 'openai-compatible:input::gpt-4.1',
        provider: 'openai-compatible:input',
      },
      {
        modelKey: 'openai-compatible:project::gpt-4.1',
        provider: 'openai-compatible:project',
      },
    ])

    const result = await resolveAnalysisModel({
      userId: 'user-1',
      inputModel: 'openai-compatible:input::gpt-4.1',
      projectAnalysisModel: 'openai-compatible:project::gpt-4.1',
    })

    expect(result).toBe('openai-compatible:input::gpt-4.1')
    expect(prismaMock.userPreference.findUnique).not.toHaveBeenCalled()
  })

  it('falls back when inputModel is no longer enabled but same provider still has another model', async () => {
    apiConfigMock.getModelsByType.mockResolvedValueOnce([
      {
        modelKey: 'openrouter::~openai/gpt-latest',
        provider: 'openrouter',
      },
      {
        modelKey: 'bailian::qwen3.5-plus',
        provider: 'bailian',
      },
    ])

    const result = await resolveAnalysisModel({
      userId: 'user-1',
      inputModel: 'openrouter::openai/gpt-5.4',
      projectAnalysisModel: 'bailian::qwen3.5-plus',
    })

    expect(result).toBe('openrouter::~openai/gpt-latest')
    expect(prismaMock.userPreference.findUnique).not.toHaveBeenCalled()
  })

  it('uses project analysisModel when inputModel is missing', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      projectAnalysisModel: 'openai-compatible:project::gpt-4.1',
    })

    expect(result).toBe('openai-compatible:project::gpt-4.1')
    expect(prismaMock.userPreference.findUnique).not.toHaveBeenCalled()
  })

  it('falls back to user preference analysisModel when project is missing', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      projectAnalysisModel: null,
    })

    expect(result).toBe('openai-compatible:pref::gpt-4.1-mini')
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { analysisModel: true },
    })
  })

  it('skips invalid input/project model keys and still falls back to user preference', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      inputModel: 'gpt-4.1',
      projectAnalysisModel: 'invalid-model-key',
    })

    expect(result).toBe('openai-compatible:pref::gpt-4.1-mini')
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledTimes(1)
  })

  it('falls back to another enabled model from the same provider when project model is no longer enabled', async () => {
    apiConfigMock.getModelsByType.mockResolvedValueOnce([
      {
        modelKey: 'openrouter::~openai/gpt-latest',
        provider: 'openrouter',
      },
      {
        modelKey: 'bailian::qwen3.5-plus',
        provider: 'bailian',
      },
    ])
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      analysisModel: 'openrouter::openai/gpt-5.4',
    })

    const result = await resolveAnalysisModel({
      userId: 'user-1',
      projectAnalysisModel: 'openrouter::openai/gpt-5.4',
    })

    expect(result).toBe('openrouter::~openai/gpt-latest')
  })

  it('throws explicit error when all levels are missing', async () => {
    apiConfigMock.getModelsByType.mockResolvedValueOnce([])
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({ analysisModel: null })

    await expect(resolveAnalysisModel({
      userId: 'user-1',
      inputModel: '',
      projectAnalysisModel: null,
    })).rejects.toThrow('ANALYSIS_MODEL_NOT_CONFIGURED')
  })
})
