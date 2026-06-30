import { beforeEach, describe, expect, it, vi } from 'vitest'

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(),
}))

vi.mock('@/lib/config-service', () => configServiceMock)

import { resolveAnalysisModel } from '@/lib/workers/handlers/resolve-analysis-model'

describe('resolveAnalysisModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configServiceMock.getUserModelConfig.mockResolvedValue({
      analysisModel: 'openrouter::openai/gpt-4.1-mini',
    })
  })

  it('uses inputModel override when provided', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      inputModel: 'openrouter::openai/gpt-4.1',
      projectAnalysisModel: 'openrouter::anthropic/claude-sonnet-4.5',
    })

    expect(result).toBe('openrouter::openai/gpt-4.1')
    expect(configServiceMock.getUserModelConfig).not.toHaveBeenCalled()
  })

  it('uses project analysisModel when inputModel is missing', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      projectAnalysisModel: 'openrouter::anthropic/claude-sonnet-4.5',
    })

    expect(result).toBe('openrouter::anthropic/claude-sonnet-4.5')
    expect(configServiceMock.getUserModelConfig).not.toHaveBeenCalled()
  })

  it('falls back to user preference analysisModel when project is missing', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      projectAnalysisModel: null,
    })

    expect(result).toBe('openrouter::openai/gpt-4.1-mini')
    expect(configServiceMock.getUserModelConfig).toHaveBeenCalledWith('user-1')
  })

  it('skips invalid input/project model keys and still falls back to user preference', async () => {
    const result = await resolveAnalysisModel({
      userId: 'user-1',
      inputModel: 'gpt-4.1',
      projectAnalysisModel: 'invalid-model-key',
    })

    expect(result).toBe('openrouter::openai/gpt-4.1-mini')
    expect(configServiceMock.getUserModelConfig).toHaveBeenCalledTimes(1)
  })

  it('throws explicit error when all levels are missing', async () => {
    configServiceMock.getUserModelConfig.mockResolvedValueOnce({ analysisModel: null })

    await expect(resolveAnalysisModel({
      userId: 'user-1',
      inputModel: '',
      projectAnalysisModel: null,
    })).rejects.toThrow('ANALYSIS_MODEL_NOT_CONFIGURED')
  })

  it('uses platform/user config analysisModel from the shared config service', async () => {
    configServiceMock.getUserModelConfig.mockResolvedValueOnce({
      analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
    })

    const result = await resolveAnalysisModel({
      userId: 'cloud-user-1',
      inputModel: null,
      projectAnalysisModel: null,
    })

    expect(result).toBe('openrouter::anthropic/claude-sonnet-4.6')
    expect(configServiceMock.getUserModelConfig).toHaveBeenCalledWith('cloud-user-1')
  })
})
