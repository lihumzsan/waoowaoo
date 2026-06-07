import { afterEach, describe, expect, it } from 'vitest'
import { getProviderConfig, hasApiConfig } from '@/lib/user-api/runtime-config'

const ORIGINAL_ENV = {
  DEPLOYMENT_EDITION: process.env.DEPLOYMENT_EDITION,
  PROVIDER_CREDENTIAL_MODE: process.env.PROVIDER_CREDENTIAL_MODE,
  PLATFORM_GOOGLE_API_KEY: process.env.PLATFORM_GOOGLE_API_KEY,
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
    process.env.PLATFORM_GOOGLE_API_KEY = 'platform-google-key'

    const config = await getProviderConfig('user-1', 'google')

    expect(config).toEqual({
      id: 'google',
      name: 'google',
      apiKey: 'platform-google-key',
    })
    await expect(hasApiConfig('user-1')).resolves.toBe(true)
  })

  it('fails explicitly when a required platform key is missing', async () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    delete process.env.PLATFORM_GOOGLE_API_KEY

    await expect(getProviderConfig('user-1', 'google')).rejects.toThrow('PLATFORM_PROVIDER_API_KEY_MISSING')
  })
})
