import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  userPreference: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}))

const billingModeMock = vi.hoisted(() => ({
  getBillingMode: vi.fn(async () => 'OFF'),
}))

const deploymentConfigMock = vi.hoisted(() => ({
  getDeploymentConfig: vi.fn(() => ({
    edition: 'self-hosted',
    providerCredentialMode: 'user-key',
  })),
  isPlatformProviderCredentialMode: vi.fn((config: { providerCredentialMode: string }) =>
    config.providerCredentialMode === 'platform-key'),
  toPublicDeploymentConfig: vi.fn((config: { edition: string; providerCredentialMode: string }) => ({
    edition: config.edition,
    providerCredentialMode: config.providerCredentialMode,
    isCloud: config.edition === 'cloud',
    usesPlatformProviderKeys: config.providerCredentialMode === 'platform-key',
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing/mode', () => billingModeMock)
vi.mock('@/lib/deployment/config', () => deploymentConfigMock)
vi.mock('@/lib/crypto-utils', () => ({
  encryptApiKey: vi.fn((value: string) => `enc:${value}`),
  decryptApiKey: vi.fn((value: string) => value.replace(/^enc:/, '')),
}))
vi.mock('@/lib/ai-registry/api-config-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai-registry/api-config-catalog')>()
  return {
    ...actual,
    buildApiConfigServerCatalog: vi.fn(() => ({ providers: [], models: [] })),
  }
})

import { getUserApiConfig, putUserApiConfig } from '@/lib/user-api/api-config-service'

const enabledAssistantModel = {
  modelId: 'assistant-model',
  modelKey: 'openrouter::assistant-model',
  name: 'Assistant Model',
  type: 'llm',
  provider: 'openrouter',
  price: 0,
}

describe('user api config service assistant model defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingModeMock.getBillingMode.mockResolvedValue('OFF')
    deploymentConfigMock.getDeploymentConfig.mockReturnValue({
      edition: 'self-hosted',
      providerCredentialMode: 'user-key',
    })
    prismaMock.userPreference.findUnique.mockResolvedValue({
      customProviders: null,
      customModels: null,
      assistantModel: null,
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      musicModel: null,
      capabilityDefaults: null,
      analysisConcurrency: null,
      imageConcurrency: null,
      videoConcurrency: null,
    })
    prismaMock.userPreference.upsert.mockResolvedValue({ id: 'pref-1' })
  })

  it('GET returns assistantModel separately from analysisModel', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customProviders: null,
      customModels: null,
      assistantModel: 'openrouter::assistant-model',
      analysisModel: 'openrouter::analysis-model',
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      musicModel: null,
      capabilityDefaults: null,
      analysisConcurrency: null,
      imageConcurrency: null,
      videoConcurrency: null,
    })

    const result = await getUserApiConfig('user-1')

    expect(result.defaultModels).toMatchObject({
      assistantModel: 'openrouter::assistant-model',
      analysisModel: 'openrouter::analysis-model',
    })
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        assistantModel: true,
        analysisModel: true,
      }),
    }))
  })

  it('PUT persists defaultModels.assistantModel as an enabled llm model key', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce({
      customProviders: null,
      customModels: JSON.stringify([enabledAssistantModel]),
      assistantModel: null,
      analysisModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      musicModel: null,
    })

    await putUserApiConfig('user-1', {
      defaultModels: {
        assistantModel: 'openrouter::assistant-model',
      },
    })

    expect(prismaMock.userPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        assistantModel: 'openrouter::assistant-model',
      }),
      create: expect.objectContaining({
        userId: 'user-1',
        assistantModel: 'openrouter::assistant-model',
      }),
    }))
  })
})
