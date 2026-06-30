import { beforeEach, describe, expect, it, vi } from 'vitest'

const deploymentConfigMock = vi.hoisted(() => ({
  getDeploymentConfig: vi.fn(),
  isPlatformProviderCredentialMode: vi.fn((config: { readonly providerCredentialMode: string }) =>
    config.providerCredentialMode === 'platform-key'),
}))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
}))

const platformRuntimeMock = vi.hoisted(() => ({
  getPlatformRuntimePlan: vi.fn((purpose: string) => ({
    purpose,
    modelKey: `platform::${purpose}`,
    generationOptions: {},
  })),
}))

vi.mock('@/lib/deployment/config', () => deploymentConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/platform-runtime/presets', () => platformRuntimeMock)

import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'

describe('resolveSystemModelKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configServiceMock.getProjectModelConfig.mockResolvedValue({
      analysisModel: 'openrouter::project-analysis',
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      singleShotVideoModel: null,
      sequenceVideoModel: null,
      musicModel: null,
    })
    configServiceMock.getUserModelConfig.mockResolvedValue({
      analysisModel: 'openrouter::user-analysis',
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      musicModel: null,
    })
  })

  it('uses platform runtime models whenever provider credentials are platform-managed', async () => {
    deploymentConfigMock.getDeploymentConfig.mockReturnValue({
      edition: 'self-hosted',
      providerCredentialMode: 'platform-key',
    })

    const result = await resolveSystemModelKey({
      userId: 'user-1',
      projectId: 'project-1',
      purpose: 'analysis',
    })

    expect(result).toBe('platform::analysis')
    expect(platformRuntimeMock.getPlatformRuntimePlan).toHaveBeenCalledWith('analysis')
    expect(configServiceMock.getProjectModelConfig).not.toHaveBeenCalled()
    expect(configServiceMock.getUserModelConfig).not.toHaveBeenCalled()
  })

  it('uses project/user config when provider credentials are user-managed, even in cloud edition', async () => {
    deploymentConfigMock.getDeploymentConfig.mockReturnValue({
      edition: 'cloud',
      providerCredentialMode: 'user-key',
    })

    const result = await resolveSystemModelKey({
      userId: 'user-1',
      projectId: 'project-1',
      purpose: 'analysis',
    })

    expect(result).toBe('openrouter::project-analysis')
    expect(configServiceMock.getProjectModelConfig).toHaveBeenCalledWith('project-1', 'user-1')
    expect(platformRuntimeMock.getPlatformRuntimePlan).not.toHaveBeenCalled()
  })
})
