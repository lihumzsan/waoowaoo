import { afterEach, describe, expect, it } from 'vitest'
import { getDeploymentConfig, toPublicDeploymentConfig } from '@/lib/deployment/config'

const ORIGINAL_ENV = {
  DEPLOYMENT_EDITION: process.env.DEPLOYMENT_EDITION,
  PROVIDER_CREDENTIAL_MODE: process.env.PROVIDER_CREDENTIAL_MODE,
}

function resetEnv() {
  if (ORIGINAL_ENV.DEPLOYMENT_EDITION === undefined) {
    delete process.env.DEPLOYMENT_EDITION
  } else {
    process.env.DEPLOYMENT_EDITION = ORIGINAL_ENV.DEPLOYMENT_EDITION
  }
  if (ORIGINAL_ENV.PROVIDER_CREDENTIAL_MODE === undefined) {
    delete process.env.PROVIDER_CREDENTIAL_MODE
  } else {
    process.env.PROVIDER_CREDENTIAL_MODE = ORIGINAL_ENV.PROVIDER_CREDENTIAL_MODE
  }
}

describe('deployment config', () => {
  afterEach(() => resetEnv())

  it('defaults to self-hosted user-key mode', () => {
    delete process.env.DEPLOYMENT_EDITION
    delete process.env.PROVIDER_CREDENTIAL_MODE

    expect(getDeploymentConfig()).toEqual({
      edition: 'self-hosted',
      providerCredentialMode: 'user-key',
    })
  })

  it('defaults cloud deployments to platform-key mode', () => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    delete process.env.PROVIDER_CREDENTIAL_MODE

    expect(getDeploymentConfig()).toEqual({
      edition: 'cloud',
      providerCredentialMode: 'platform-key',
    })
  })

  it('fails explicitly for invalid deployment values', () => {
    process.env.DEPLOYMENT_EDITION = 'prod'

    expect(() => getDeploymentConfig()).toThrow('DEPLOYMENT_EDITION_INVALID')
  })

  it('exposes a safe public deployment shape', () => {
    const publicConfig = toPublicDeploymentConfig({
      edition: 'cloud',
      providerCredentialMode: 'platform-key',
    })

    expect(publicConfig).toEqual({
      edition: 'cloud',
      providerCredentialMode: 'platform-key',
      isCloud: true,
      usesPlatformProviderKeys: true,
    })
  })
})
