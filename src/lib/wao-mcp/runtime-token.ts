import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const WAO_RUNTIME_TOKEN_PREFIX = 'waort1'
const WAO_RUNTIME_TOKEN_PURPOSE = 'wao-codex-runtime-capability:v1'
const WAO_RUNTIME_TOKEN_MAX_CHARS = 4_000

export const WAO_RUNTIME_TOKEN_DEFAULT_TTL_SECONDS = 30 * 60
export const WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS = 60 * 60

export const waoRuntimeTokenPayloadSchema = z.object({
  userId: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  assistantId: z.string().min(1).max(128),
  expiry: z.number().int().positive(),
  nonce: z.string().min(16).max(128),
}).strict()

export type WaoRuntimeTokenPayload = z.infer<
  typeof waoRuntimeTokenPayloadSchema
>

export type WaoRuntimeTokenScope = Omit<
  WaoRuntimeTokenPayload,
  'expiry' | 'nonce'
>

export type WaoRuntimeTokenErrorCode =
  | 'SECRET_UNAVAILABLE'
  | 'MALFORMED'
  | 'SIGNATURE_INVALID'
  | 'PAYLOAD_INVALID'
  | 'EXPIRED'
  | 'TTL_INVALID'

export class WaoRuntimeTokenError extends Error {
  readonly code: WaoRuntimeTokenErrorCode

  constructor(code: WaoRuntimeTokenErrorCode) {
    super(`WAO_RUNTIME_TOKEN_${code}`)
    this.name = 'WaoRuntimeTokenError'
    this.code = code
  }
}

function readRootSecret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (typeof value !== 'string' || value.length < 24) {
    throw new WaoRuntimeTokenError('SECRET_UNAVAILABLE')
  }
  return value
}

function deriveSigningKey(): Buffer {
  return createHmac('sha256', readRootSecret())
    .update(WAO_RUNTIME_TOKEN_PURPOSE, 'utf8')
    .digest()
}

function signEncodedPayload(encodedPayload: string): string {
  return createHmac('sha256', deriveSigningKey())
    .update(`${WAO_RUNTIME_TOKEN_PURPOSE}.${encodedPayload}`, 'utf8')
    .digest('base64url')
}

function normalizeNowSeconds(now: Date): number {
  const milliseconds = now.getTime()
  if (!Number.isFinite(milliseconds)) {
    throw new WaoRuntimeTokenError('TTL_INVALID')
  }
  return Math.floor(milliseconds / 1_000)
}

/**
 * Issues a short-lived capability token for one Wao project runtime. Its nonce
 * is also the Redis placement owner token, so releasing or rotating the
 * Runtime invalidates model, search, and MCP access before token expiry. Thread
 * and directory identities stay out of the token: the unique running product
 * Turn remains the per-call execution fence resolved from MySQL.
 * The runtime container receives this token, never database/provider/auth keys.
 */
export function issueWaoRuntimeToken(params: {
  readonly scope: WaoRuntimeTokenScope
  readonly ttlSeconds?: number
  readonly now?: Date
}): { readonly token: string; readonly payload: WaoRuntimeTokenPayload } {
  const ttlSeconds =
    params.ttlSeconds ?? WAO_RUNTIME_TOKEN_DEFAULT_TTL_SECONDS
  if (
    !Number.isInteger(ttlSeconds)
    || ttlSeconds <= 0
    || ttlSeconds > WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS
  ) {
    throw new WaoRuntimeTokenError('TTL_INVALID')
  }
  const payload = waoRuntimeTokenPayloadSchema.parse({
    ...params.scope,
    expiry: normalizeNowSeconds(params.now ?? new Date()) + ttlSeconds,
    nonce: randomUUID(),
  })
  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    'utf8',
  ).toString('base64url')
  return {
    token: `${WAO_RUNTIME_TOKEN_PREFIX}.${encodedPayload}.${signEncodedPayload(encodedPayload)}`,
    payload,
  }
}

export function verifyWaoRuntimeToken(
  token: string,
  params?: { readonly now?: Date },
): WaoRuntimeTokenPayload {
  const normalized = token.trim()
  if (!normalized || normalized.length > WAO_RUNTIME_TOKEN_MAX_CHARS) {
    throw new WaoRuntimeTokenError('MALFORMED')
  }
  const [prefix, encodedPayload, signature, ...rest] = normalized.split('.')
  if (
    prefix !== WAO_RUNTIME_TOKEN_PREFIX
    || !encodedPayload
    || !signature
    || rest.length > 0
  ) {
    throw new WaoRuntimeTokenError('MALFORMED')
  }
  const expected = Buffer.from(signEncodedPayload(encodedPayload), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new WaoRuntimeTokenError('SIGNATURE_INVALID')
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    )
  } catch {
    throw new WaoRuntimeTokenError('PAYLOAD_INVALID')
  }
  const parsed = waoRuntimeTokenPayloadSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new WaoRuntimeTokenError('PAYLOAD_INVALID')
  }
  if (parsed.data.expiry <= normalizeNowSeconds(params?.now ?? new Date())) {
    throw new WaoRuntimeTokenError('EXPIRED')
  }
  return parsed.data
}

export function verifyWaoRuntimeBearerAuthorization(
  authorization: string | null,
  params?: { readonly now?: Date },
): WaoRuntimeTokenPayload {
  if (!authorization) {
    throw new WaoRuntimeTokenError('MALFORMED')
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  if (!match?.[1]) {
    throw new WaoRuntimeTokenError('MALFORMED')
  }
  return verifyWaoRuntimeToken(match[1], params)
}
