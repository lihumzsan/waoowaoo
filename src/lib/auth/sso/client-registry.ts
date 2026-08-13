import { timingSafeEqual } from 'node:crypto'

export const WAO_SSO_CLIENT_ID = 'wao-horror' as const

export type WaoSsoClient = {
  readonly clientId: typeof WAO_SSO_CLIENT_ID
  readonly clientSecret: string
  readonly redirectUri: string
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
}

export function readWaoSsoProviderBaseUrl(): string {
  const value = process.env.NEXTAUTH_URL?.trim() ?? ''
  try {
    const url = new URL(value)
    const secure = url.protocol === 'https:'
      || (url.protocol === 'http:' && isLoopbackHost(url.hostname))
    if (
      !secure
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.pathname !== '/'
    ) throw new Error('NEXTAUTH_URL_INVALID')
    return url.toString()
  } catch {
    throw new Error('NEXTAUTH_URL_INVALID')
  }
}

function parseRedirectUri(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('WAO_SSO_REDIRECT_URI_INVALID')
  }
  const providerUrl = new URL(readWaoSsoProviderBaseUrl())
  const secure = url.protocol === 'https:'
    || (
      providerUrl.protocol === 'http:'
      && url.protocol === 'http:'
      && isLoopbackHost(url.hostname)
    )
  if (
    !secure
    || url.username
    || url.password
    || url.hash
    || url.search
    || url.pathname !== '/api/auth/callback/wao-sso'
  ) throw new Error('WAO_SSO_REDIRECT_URI_INVALID')
  return url.toString()
}

export function readWaoSsoClient(): WaoSsoClient {
  const clientSecret = process.env.WAO_SSO_HORROR_CLIENT_SECRET ?? ''
  const normalizedSecret = clientSecret.toLowerCase()
  if (
    !/^[A-Za-z0-9_-]{43,128}$/u.test(clientSecret)
    || new Set(clientSecret).size < 12
    || normalizedSecret.includes('changeme')
    || normalizedSecret.includes('default')
    || normalizedSecret.includes('example')
  ) throw new Error('WAO_SSO_CLIENT_SECRET_INVALID')
  return {
    clientId: WAO_SSO_CLIENT_ID,
    clientSecret,
    redirectUri: parseRedirectUri(process.env.WAO_SSO_HORROR_REDIRECT_URI?.trim() ?? ''),
  }
}

export function isWaoSsoClientSecretValid(expected: string, candidate: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const candidateBuffer = Buffer.from(candidate, 'utf8')
  return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer)
}
