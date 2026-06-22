import { afterEach, describe, expect, it } from 'vitest'
import { getProviderConfig, getUserModels, hasApiConfig, resolveModelSelection } from '@/lib/user-api/runtime-config'
import { putUserApiConfig } from '@/lib/user-api/api-config-service'

const ORIGINAL_ENV = {
  DEPLOYMENT_EDITION: process.env.DEPLOYMENT_EDITION,
  PROVIDER_CREDENTIAL_MODE: process.env.PROVIDER_CREDENTIAL_MODE,
  PLATFORM_GOOGLE_API_KEY: process.env.PLATFORM_GOOGLE_API_KEY,
  PLATFORM_OPENROUTER_API_KEY: process.env.PLATFORM_OPENROUTER_API_KEY,
  PLATFORM_OPENROUTER_BASE_URL: process.env.PLATFORM_OPENROUTER_BASE_URL,
  BILLING_MODE: process.env.BILLING_MODE,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

describe('platform provider config', () => {
  afterEach(() => restoreEnv())

  it('reads platform provider keys in platform-key mode', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.PLATFORM_OPENROUTER_API_KEY = 'platform-openrouter-key'
    process.env.PLATFORM_OPENROUTER_BASE_URL = 'https://openrouter.example/api/v1'

    const config = await getProviderConfig('user-1', 'openrouter')

    expect(config).toEqual({
      id: 'openrouter',
      name: 'openrouter',
      apiKey: 'platform-openrouter-key',
      baseUrl: 'https://openrouter.example/api/v1',
    })
    await expect(hasApiConfig('user-1')).resolves.toBe(true)
  })

  it('fails explicitly when a required platform key is missing', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    delete process.env.PLATFORM_OPENROUTER_API_KEY

    await expect(getProviderConfig('user-1', 'openrouter')).rejects.toThrow('PLATFORM_PROVIDER_API_KEY_MISSING')
  })

  it('fails explicitly when a required platform base URL is missing', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.PLATFORM_OPENROUTER_API_KEY = 'platform-openrouter-key'
    delete process.env.PLATFORM_OPENROUTER_BASE_URL

    await expect(getProviderConfig('user-1', 'openrouter')).rejects.toThrow('PLATFORM_PROVIDER_BASE_URL_MISSING')
  })

  it('uses platform models in platform-key mode without user config', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'

    const models = await getUserModels('user-1')
    expect(models.map((model) => model.modelKey)).toContain('openrouter::anthropic/claude-sonnet-4.6')
    expect(models.map((model) => model.modelKey)).toContain('openrouter::openai/gpt-5.5')
    expect(models.map((model) => model.modelKey)).toContain('fal::gpt-image-2')
    expect(models.map((model) => model.modelKey)).toContain('fal::fal-ai/lyria3/pro')

    await expect(resolveModelSelection('user-1', 'openrouter::anthropic/claude-sonnet-4.6', 'llm')).resolves.toMatchObject({
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
      mediaType: 'llm',
    })
  })

  it('rejects user API config writes in platform-key mode', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'

    await expect(putUserApiConfig('user-1', {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
