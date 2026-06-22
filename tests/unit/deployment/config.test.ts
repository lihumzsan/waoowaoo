import { afterEach, describe, expect, it } from 'vitest'
import { getDeploymentConfig, toPublicDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures, toPublicDeploymentFeatures } from '@/lib/deployment/features'

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

  it('keeps self-hosted commercial surfaces disabled while API configuration stays available', () => {
    const features = getDeploymentFeatures({
      edition: 'self-hosted',
      providerCredentialMode: 'user-key',
    })

    expect(features).toEqual({
      showOfficialPublicPages: false,
      showPricingPage: false,
      showLegalPages: false,
      showRecharge: false,
      showInviteCode: false,
      showBilling: false,
      showApiConfig: true,
      showUpdateCheck: true,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: false,
    })
  })

  it('enables official cloud public, billing, and invite surfaces without exposing API configuration', () => {
    const features = getDeploymentFeatures({
      edition: 'cloud',
      providerCredentialMode: 'platform-key',
    })

    expect(toPublicDeploymentFeatures(features)).toEqual({
      showOfficialPublicPages: true,
      showPricingPage: true,
      showLegalPages: true,
      showRecharge: true,
      showInviteCode: true,
      showBilling: true,
      showApiConfig: false,
      showUpdateCheck: false,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: true,
    })
  })
})
