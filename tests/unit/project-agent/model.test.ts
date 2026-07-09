import { afterEach, describe, expect, it, vi } from 'vitest'

const deploymentConfigMock = vi.hoisted(() => ({
  getDeploymentConfig: vi.fn(() => ({
    edition: 'cloud',
    providerCredentialMode: 'platform-key',
  })),
  isPlatformProviderCredentialMode: vi.fn((config: { providerCredentialMode: string }) =>
    config.providerCredentialMode === 'platform-key'),
}))

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(),
}))

vi.mock('@/lib/deployment/config', () => deploymentConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)

import {
  DEFAULT_PROJECT_AGENT_ASSISTANT_MODEL_KEY,
  resolveProjectAgentAssistantModelKey,
} from '@/lib/project-agent/model'

const ORIGINAL_ASSISTANT_MODEL = process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL
const ORIGINAL_ANALYSIS_MODEL = process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL

afterEach(() => {
  vi.clearAllMocks()
  deploymentConfigMock.getDeploymentConfig.mockReturnValue({
    edition: 'cloud',
    providerCredentialMode: 'platform-key',
  })
  deploymentConfigMock.isPlatformProviderCredentialMode.mockImplementation((config: { providerCredentialMode: string }) =>
    config.providerCredentialMode === 'platform-key')
  configServiceMock.getUserModelConfig.mockReset()
  if (ORIGINAL_ASSISTANT_MODEL === undefined) {
    delete process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL
  } else {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = ORIGINAL_ASSISTANT_MODEL
  }
  if (ORIGINAL_ANALYSIS_MODEL === undefined) {
    delete process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL
  } else {
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = ORIGINAL_ANALYSIS_MODEL
  }
})

describe('project agent model routing', () => {
  it('defaults the platform assistant model to OpenRouter GPT-5.5', async () => {
    delete process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL

    await expect(resolveProjectAgentAssistantModelKey('user-1')).resolves.toBe('openrouter::openai/gpt-5.5')
    expect(DEFAULT_PROJECT_AGENT_ASSISTANT_MODEL_KEY).toBe('openrouter::openai/gpt-5.5')
    expect(configServiceMock.getUserModelConfig).not.toHaveBeenCalled()
  })

  it('uses PLATFORM_DEFAULT_ASSISTANT_MODEL without reading analysis model defaults', async () => {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = 'openrouter::openai/gpt-5.5'
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = 'openrouter::google/gemini-3.5-flash'

    await expect(resolveProjectAgentAssistantModelKey('user-1')).resolves.toBe('openrouter::openai/gpt-5.5')
  })

  it('uses self-hosted user assistantModel instead of platform env defaults', async () => {
    deploymentConfigMock.getDeploymentConfig.mockReturnValue({
      edition: 'self-hosted',
      providerCredentialMode: 'user-key',
    })
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = 'openrouter::openai/gpt-5.5'
    configServiceMock.getUserModelConfig.mockResolvedValue({
      assistantModel: 'openrouter::user-assistant',
      analysisModel: 'openrouter::user-analysis',
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      musicModel: null,
      capabilityDefaults: {},
    })

    await expect(resolveProjectAgentAssistantModelKey('user-1')).resolves.toBe('openrouter::user-assistant')
    expect(configServiceMock.getUserModelConfig).toHaveBeenCalledWith('user-1')
  })

  it('fails explicitly when self-hosted assistantModel is missing', async () => {
    deploymentConfigMock.getDeploymentConfig.mockReturnValue({
      edition: 'self-hosted',
      providerCredentialMode: 'user-key',
    })
    configServiceMock.getUserModelConfig.mockResolvedValue({
      assistantModel: null,
      analysisModel: 'openrouter::user-analysis',
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoModel: null,
      musicModel: null,
      capabilityDefaults: {},
    })

    await expect(resolveProjectAgentAssistantModelKey('user-1')).rejects.toThrow(
      'PROJECT_AGENT_ASSISTANT_MODEL_NOT_CONFIGURED',
    )
  })

  it('fails explicitly for invalid assistant model keys', async () => {
    process.env.PLATFORM_DEFAULT_ASSISTANT_MODEL = 'openai/gpt-5.5'

    await expect(resolveProjectAgentAssistantModelKey('user-1')).rejects.toThrow(
      'PROJECT_AGENT_ASSISTANT_MODEL_INVALID:openai/gpt-5.5',
    )
  })
})
