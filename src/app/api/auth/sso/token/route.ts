import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { AUTH_SSO_TOKEN_LIMIT, checkRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  exchangeAuthorizationCode,
  readBasicClientCredentials,
  WaoSsoProtocolError,
} from '@/lib/auth/sso/service'

export const runtime = 'nodejs'

const TOKEN_PARAMETER_NAMES = new Set(['grant_type', 'code', 'redirect_uri', 'code_verifier'])
const MAX_TOKEN_REQUEST_BYTES = 8 * 1_024

type TokenError =
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_request'
  | 'temporarily_unavailable'
  | 'unsupported_grant_type'

function oauthError(status: number, error: TokenError, retryAfterSeconds?: number): NextResponse {
  return NextResponse.json({ error }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...(retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : {}),
      ...(error === 'invalid_client' ? { 'WWW-Authenticate': 'Basic realm="wao-sso"' } : {}),
    },
  })
}

function readSingleParameter(parameters: URLSearchParams, name: string): string | null {
  const values = parameters.getAll(name)
  return values.length === 1 ? values[0] : null
}

export const POST = apiHandler(async (request: NextRequest) => {
  const credentials = readBasicClientCredentials(request.headers.get('authorization'))
  if (!credentials) return oauthError(401, 'invalid_client')
  const rate = await checkRateLimit('auth:sso:token', getClientIp(request), AUTH_SSO_TOKEN_LIMIT)
  if (rate.limited) return oauthError(429, 'temporarily_unavailable', rate.retryAfterSeconds)
  let body: URLSearchParams
  try {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
      return oauthError(400, 'invalid_request')
    }
    const contentLength = request.headers.get('content-length')
    if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_TOKEN_REQUEST_BYTES)) {
      return oauthError(400, 'invalid_request')
    }
    const rawBody = await request.text()
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_TOKEN_REQUEST_BYTES) {
      return oauthError(400, 'invalid_request')
    }
    body = new URLSearchParams(rawBody)
  } catch {
    return oauthError(400, 'invalid_request')
  }
  for (const name of body.keys()) {
    if (!TOKEN_PARAMETER_NAMES.has(name)) return oauthError(400, 'invalid_request')
  }
  const grantType = readSingleParameter(body, 'grant_type')
  const code = readSingleParameter(body, 'code')
  const redirectUri = readSingleParameter(body, 'redirect_uri')
  const codeVerifier = readSingleParameter(body, 'code_verifier')
  if (!grantType || !code || !redirectUri || !codeVerifier) return oauthError(400, 'invalid_request')
  if (grantType !== 'authorization_code') return oauthError(400, 'unsupported_grant_type')
  try {
    const token = await exchangeAuthorizationCode({
      ...credentials,
      code,
      redirectUri,
      codeVerifier,
    })
    return NextResponse.json({
      access_token: token.accessToken,
      token_type: 'Bearer',
      expires_in: token.expiresIn,
      scope: token.scope,
    }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
  } catch (error) {
    if (!(error instanceof WaoSsoProtocolError)) throw error
    if (error.code === 'invalid_client') return oauthError(401, 'invalid_client')
    if (error.code === 'invalid_grant') return oauthError(400, 'invalid_grant')
    throw error
  }
})
