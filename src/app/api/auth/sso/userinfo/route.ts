import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { readAccessTokenProfile, WaoSsoProtocolError } from '@/lib/auth/sso/service'
import { AUTH_SSO_USERINFO_LIMIT, checkRateLimit, getClientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const GET = apiHandler(async (request: NextRequest) => {
  const rate = await checkRateLimit('auth:sso:userinfo', getClientIp(request), AUTH_SSO_USERINFO_LIMIT)
  if (rate.limited) {
    return NextResponse.json({ error: 'temporarily_unavailable' }, {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Retry-After': String(rate.retryAfterSeconds),
      },
    })
  }
  try {
    const profile = await readAccessTokenProfile(request.headers.get('authorization'))
    return NextResponse.json(profile, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } })
  } catch (error) {
    if (!(error instanceof WaoSsoProtocolError) || error.code !== 'invalid_token') throw error
    return NextResponse.json({ error: 'invalid_token' }, {
      status: 401,
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'WWW-Authenticate': 'Bearer realm="wao-sso"',
      },
    })
  }
})
