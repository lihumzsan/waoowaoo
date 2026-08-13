import { NextRequest, NextResponse } from 'next/server'
import { apiHandler } from '@/lib/api-errors'
import { readExistingAuthSession } from '@/lib/api-auth'
import {
  issueAuthorizationCode,
  parseAuthorizeRequest,
  WaoSsoProtocolError,
} from '@/lib/auth/sso/service'
import { readWaoSsoProviderBaseUrl } from '@/lib/auth/sso/client-registry'

export const runtime = 'nodejs'

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export const GET = apiHandler(async (request: NextRequest) => {
  let authorization
  try {
    authorization = parseAuthorizeRequest(request.nextUrl)
  } catch (error) {
    if (!(error instanceof WaoSsoProtocolError) || error.code !== 'invalid_request') throw error
    return noStore(NextResponse.json({ error: 'invalid_request' }, { status: 400 }))
  }
  const session = await readExistingAuthSession()
  if (!session) {
    const signIn = new URL('/auth/signin', readWaoSsoProviderBaseUrl())
    signIn.searchParams.set('postAuthTarget', `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return noStore(NextResponse.redirect(signIn, 302))
  }
  const code = await issueAuthorizationCode({ request: authorization, userId: session.user.id })
  const callback = new URL(authorization.redirectUri)
  callback.searchParams.set('code', code)
  callback.searchParams.set('state', authorization.state)
  return noStore(NextResponse.redirect(callback, 302))
})
