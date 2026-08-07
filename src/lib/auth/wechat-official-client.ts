import { createHash } from 'node:crypto'
import { redis } from '@/lib/redis'
import {
  readWechatOfficialConfig,
  WECHAT_OFFICIAL_RESULT_CODES,
  WechatOfficialError,
} from '@/lib/auth/wechat-official-config'

const WECHAT_API_BASE_URL = 'https://api.weixin.qq.com'
const WECHAT_QR_IMAGE_BASE_URL = 'https://mp.weixin.qq.com/cgi-bin/showqrcode'
const ACCESS_TOKEN_SAFETY_SECONDS = 300

interface AccessTokenPayload {
  access_token: string
  expires_in: number
}

interface WechatApiErrorPayload {
  errcode: number
  errmsg?: string
}

interface QrCodePayload {
  ticket: string
  expire_seconds: number
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readWechatApiError(value: unknown): WechatApiErrorPayload | null {
  if (!isRecord(value) || typeof value.errcode !== 'number' || value.errcode === 0) return null
  return {
    errcode: value.errcode,
    errmsg: typeof value.errmsg === 'string' ? value.errmsg : undefined,
  }
}

function readAccessTokenPayload(value: unknown): AccessTokenPayload | null {
  if (!isRecord(value)) return null
  if (typeof value.access_token !== 'string' || !value.access_token) return null
  if (typeof value.expires_in !== 'number' || value.expires_in <= 0) return null
  return { access_token: value.access_token, expires_in: value.expires_in }
}

function readQrCodePayload(value: unknown): QrCodePayload | null {
  if (!isRecord(value)) return null
  if (typeof value.ticket !== 'string' || !value.ticket) return null
  if (typeof value.expire_seconds !== 'number' || value.expire_seconds <= 0) return null
  if (typeof value.url !== 'string' || !value.url) return null
  return {
    ticket: value.ticket,
    expire_seconds: value.expire_seconds,
    url: value.url,
  }
}

function accessTokenCacheKey(appId: string): string {
  const digest = createHash('sha256').update(appId).digest('base64url')
  return `auth:wechat-official:access-token:${digest}`
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.providerUnavailable, error)
  }
}

async function fetchStableAccessToken(forceRefresh: boolean): Promise<string> {
  const config = readWechatOfficialConfig()
  const cacheKey = accessTokenCacheKey(config.appId)
  if (!forceRefresh) {
    const cached = await redis.get(cacheKey)
    if (cached) return cached
  }

  let response: Response
  try {
    response = await fetch(`${WECHAT_API_BASE_URL}/cgi-bin/stable_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credential',
        appid: config.appId,
        secret: config.appSecret,
        force_refresh: forceRefresh,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
  } catch (error) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.providerUnavailable, error)
  }
  const payload = await readJsonResponse(response)
  const tokenPayload = response.ok ? readAccessTokenPayload(payload) : null
  if (!tokenPayload || readWechatApiError(payload)) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.providerUnavailable)
  }
  const ttlSeconds = Math.max(60, tokenPayload.expires_in - ACCESS_TOKEN_SAFETY_SECONDS)
  await redis.set(cacheKey, tokenPayload.access_token, 'EX', ttlSeconds)
  return tokenPayload.access_token
}

async function requestTemporaryQr(scene: string, forceRefresh: boolean): Promise<QrCodePayload> {
  const accessToken = await fetchStableAccessToken(forceRefresh)
  let response: Response
  try {
    response = await fetch(
      `${WECHAT_API_BASE_URL}/cgi-bin/qrcode/create?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expire_seconds: 300,
          action_name: 'QR_STR_SCENE',
          action_info: { scene: { scene_str: scene } },
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      },
    )
  } catch (error) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.providerUnavailable, error)
  }
  const payload = await readJsonResponse(response)
  const apiError = readWechatApiError(payload)
  if (!forceRefresh && apiError && [40014, 42001].includes(apiError.errcode)) {
    const config = readWechatOfficialConfig()
    const cacheKey = accessTokenCacheKey(config.appId)
    const cached = await redis.get(cacheKey)
    if (cached === accessToken) await redis.del(cacheKey)
    return await requestTemporaryQr(scene, true)
  }
  const qr = response.ok ? readQrCodePayload(payload) : null
  if (!qr || apiError) {
    throw new WechatOfficialError(WECHAT_OFFICIAL_RESULT_CODES.providerUnavailable)
  }
  return qr
}

export async function createWechatTemporaryQr(scene: string): Promise<{
  imageUrl: string
  expiresInSeconds: number
}> {
  const qr = await requestTemporaryQr(scene, false)
  return {
    imageUrl: `${WECHAT_QR_IMAGE_BASE_URL}?ticket=${encodeURIComponent(qr.ticket)}`,
    expiresInSeconds: qr.expire_seconds,
  }
}
