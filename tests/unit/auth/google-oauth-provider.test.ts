import { afterEach, describe, expect, it } from 'vitest'
import { authOptions } from '@/lib/auth'
import { createGoogleOAuthProvider } from '@/lib/auth/google-oauth'
import { getDeploymentFeatures } from '@/lib/deployment/features'

const ORIGINAL_ENV = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
}

function restoreEnv(name: keyof typeof ORIGINAL_ENV): void {
  const value = ORIGINAL_ENV[name]
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

describe('Google OAuth provider deployment gating', () => {
  afterEach(() => {
    restoreEnv('GOOGLE_CLIENT_ID')
    restoreEnv('GOOGLE_CLIENT_SECRET')
  })

  it('boots self-hosted auth without Google credentials and registers only credentials login', () => {
    expect(authOptions.providers.map((provider) => provider.id)).toEqual(['credentials'])
  })

  it('does not require Google OAuth credentials when self-hosted deployment disables the provider', () => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    const features = getDeploymentFeatures({
      edition: 'self-hosted',
      providerCredentialMode: 'user-key',
    })

    expect(createGoogleOAuthProvider(features)).toBeNull()
  })

  it('fails explicitly when cloud deployment enables Google OAuth without credentials', () => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    const features = getDeploymentFeatures({
      edition: 'cloud',
      providerCredentialMode: 'platform-key',
    })

    expect(() => createGoogleOAuthProvider(features)).toThrow('GOOGLE_CLIENT_ID_MISSING')
  })

  it('creates the Google provider from explicit cloud credentials', () => {
    process.env.GOOGLE_CLIENT_ID = 'cloud-google-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'cloud-google-client-secret'
    const features = getDeploymentFeatures({
      edition: 'cloud',
      providerCredentialMode: 'platform-key',
    })

    const provider = createGoogleOAuthProvider(features)

    expect(provider).toMatchObject({
      id: 'google',
      type: 'oauth',
      options: {
        clientId: 'cloud-google-client-id',
        clientSecret: 'cloud-google-client-secret',
        allowDangerousEmailAccountLinking: false,
      },
    })
  })
})
