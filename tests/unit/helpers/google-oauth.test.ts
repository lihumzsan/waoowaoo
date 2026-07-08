import { afterEach, describe, expect, it } from 'vitest'
import { readGoogleOAuthConfig, readVerifiedGoogleProfileEmail } from '@/lib/auth/google-oauth'

describe('google oauth helpers', () => {
  const originalClientId = process.env.GOOGLE_CLIENT_ID
  const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET

  afterEach(() => {
    if (originalClientId === undefined) {
      delete process.env.GOOGLE_CLIENT_ID
    } else {
      process.env.GOOGLE_CLIENT_ID = originalClientId
    }

    if (originalClientSecret === undefined) {
      delete process.env.GOOGLE_CLIENT_SECRET
    } else {
      process.env.GOOGLE_CLIENT_SECRET = originalClientSecret
    }
  })

  it('[Google OAuth 配置] -> 缺少 client secret 时显式失败', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id'
    delete process.env.GOOGLE_CLIENT_SECRET

    expect(() => readGoogleOAuthConfig()).toThrow('GOOGLE_CLIENT_SECRET_MISSING')
  })

  it('[Google OAuth 配置] -> 读取并修剪 client id 与 secret', () => {
    process.env.GOOGLE_CLIENT_ID = ' client-id '
    process.env.GOOGLE_CLIENT_SECRET = ' client-secret '

    expect(readGoogleOAuthConfig()).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })
  })

  it('[Google OAuth profile] -> 只接受已验证邮箱并统一为小写', () => {
    expect(
      readVerifiedGoogleProfileEmail({
        email: 'User@Example.COM ',
        email_verified: true,
      }),
    ).toBe('user@example.com')
  })

  it('[Google OAuth profile] -> 未验证邮箱不能登录', () => {
    expect(
      readVerifiedGoogleProfileEmail({
        email: 'user@example.com',
        email_verified: false,
      }),
    ).toBeNull()
  })
})
