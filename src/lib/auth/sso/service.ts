import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import {
  isWaoSsoClientSecretValid,
  readWaoSsoClient,
  WAO_SSO_CLIENT_ID,
} from './client-registry'
import { parsePkceChallenge, verifyPkceS256 } from './pkce'

const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
const AUTHORIZE_PARAMETER_NAMES = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'scope',
  'code_challenge',
  'code_challenge_method',
])

export type WaoSsoProtocolErrorCode =
  | 'invalid_client'
  | 'invalid_grant'
  | 'invalid_request'
  | 'invalid_token'

export class WaoSsoProtocolError extends Error {
  readonly code: WaoSsoProtocolErrorCode

  constructor(code: WaoSsoProtocolErrorCode) {
    super(`WAO_SSO_${code.toUpperCase()}`)
    this.name = 'WaoSsoProtocolError'
    this.code = code
  }
}

export type AuthorizeRequest = {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly scope: 'profile'
  readonly codeChallenge: string
}

export type WaoSsoProfile = {
  readonly sub: string
  readonly name: string
  readonly picture: string | null
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function opaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

function invalid(code: WaoSsoProtocolErrorCode): never {
  throw new WaoSsoProtocolError(code)
}

function readSingleParameter(parameters: URLSearchParams, name: string): string {
  const values = parameters.getAll(name)
  if (values.length !== 1) invalid('invalid_request')
  return values[0]
}

export function parseAuthorizeRequest(url: URL): AuthorizeRequest {
  for (const name of url.searchParams.keys()) {
    if (!AUTHORIZE_PARAMETER_NAMES.has(name)) invalid('invalid_request')
  }
  const responseType = readSingleParameter(url.searchParams, 'response_type')
  const clientId = readSingleParameter(url.searchParams, 'client_id')
  const redirectUri = readSingleParameter(url.searchParams, 'redirect_uri')
  const state = readSingleParameter(url.searchParams, 'state')
  const scope = readSingleParameter(url.searchParams, 'scope')
  const challengeMethod = readSingleParameter(url.searchParams, 'code_challenge_method')
  const challenge = readSingleParameter(url.searchParams, 'code_challenge')
  const client = readWaoSsoClient()
  if (
    responseType !== 'code'
    || clientId !== client.clientId
    || redirectUri !== client.redirectUri
    || scope !== 'profile'
    || state.length < 16
    || state.length > 2_048
    || challengeMethod !== 'S256'
  ) invalid('invalid_request')
  let codeChallenge: string
  try {
    codeChallenge = parsePkceChallenge(challenge)
  } catch {
    invalid('invalid_request')
  }
  return {
    clientId,
    redirectUri,
    state,
    scope: 'profile',
    codeChallenge,
  }
}

export async function issueAuthorizationCode(input: {
  readonly request: AuthorizeRequest
  readonly userId: string
}): Promise<string> {
  const code = opaqueToken()
  await prisma.waoSsoAuthorizationCode.create({
    data: {
      codeHash: sha256(code),
      clientId: input.request.clientId,
      userId: input.userId,
      redirectUri: input.request.redirectUri,
      scope: input.request.scope,
      codeChallenge: input.request.codeChallenge,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    },
  })
  return code
}

export function readBasicClientCredentials(authorization: string | null): {
  readonly clientId: string
  readonly clientSecret: string
} | null {
  const match = authorization?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/iu)
  if (!match) return null
  const encoded = match[1]
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.toString('base64') !== encoded) return null
  const decoded = buffer.toString('utf8')
  if (Buffer.from(decoded, 'utf8').compare(buffer) !== 0) return null
  const separator = decoded.indexOf(':')
  if (separator <= 0 || separator !== decoded.lastIndexOf(':')) return null
  return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) }
}

export async function exchangeAuthorizationCode(input: {
  readonly clientId: string
  readonly clientSecret: string
  readonly code: string
  readonly redirectUri: string
  readonly codeVerifier: string
}): Promise<{ readonly accessToken: string; readonly expiresIn: number; readonly scope: string }> {
  const client = readWaoSsoClient()
  if (
    input.clientId !== client.clientId
    || !isWaoSsoClientSecretValid(client.clientSecret, input.clientSecret)
  ) invalid('invalid_client')
  if (input.redirectUri !== client.redirectUri || !/^[A-Za-z0-9_-]{43}$/u.test(input.code)) {
    invalid('invalid_grant')
  }
  const codeHash = sha256(input.code)
  const accessToken = opaqueToken()
  const now = new Date()
  await prisma.$transaction(async (transaction) => {
    const authorizationCode = await transaction.waoSsoAuthorizationCode.findUnique({ where: { codeHash } })
    if (
      !authorizationCode
      || authorizationCode.consumedAt
      || authorizationCode.expiresAt <= now
      || authorizationCode.clientId !== client.clientId
      || authorizationCode.redirectUri !== client.redirectUri
      || !verifyPkceS256(input.codeVerifier, authorizationCode.codeChallenge)
    ) invalid('invalid_grant')
    const consumed = await transaction.waoSsoAuthorizationCode.updateMany({
      where: { id: authorizationCode.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    })
    if (consumed.count !== 1) invalid('invalid_grant')
    await transaction.waoSsoAccessToken.create({
      data: {
        tokenHash: sha256(accessToken),
        clientId: client.clientId,
        userId: authorizationCode.userId,
        scope: authorizationCode.scope,
        expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1_000),
      },
    })
  })
  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, scope: 'profile' }
}

export async function readAccessTokenProfile(authorization: string | null): Promise<WaoSsoProfile> {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/iu)?.[1]
  if (!token) invalid('invalid_token')
  const access = await prisma.waoSsoAccessToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, name: true, image: true } } },
  })
  if (!access || access.revokedAt || access.expiresAt <= new Date() || access.clientId !== WAO_SSO_CLIENT_ID) {
    invalid('invalid_token')
  }
  return { sub: access.user.id, name: access.user.name, picture: access.user.image }
}
