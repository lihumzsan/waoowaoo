import net from 'node:net'
import { lookup } from 'node:dns/promises'
import { createScopedLogger } from '@/lib/logging/core'
import { getInternalBaseUrl } from '@/lib/env'
import { resolveMediaMimeType } from '@/lib/media/media-mime'
import {
  OwnedMediaOutboundError,
  readOwnedMediaForGeneration,
} from '@/lib/media/outbound-owned-media'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { MAX_IMAGE_BYTES, readResponseBufferWithLimit } from '@/lib/http/body-limits'

export { detectMimeFromBuffer } from '@/lib/media/media-mime'

type StorageHelpers = Pick<typeof import('@/lib/storage'), 'getSignedObjectUrl' | 'toFetchableUrl'>

type InputIssueReason =
  | 'next_image_unwrapped'
  | 'empty_value_skipped'
  | 'relative_path_rejected'
  | 'non_string_skipped'

export type OutboundImageInputIssue = {
  index: number
  input: unknown
  normalized?: string
  reason: InputIssueReason
}

export type OutboundImageNormalizeStage =
  | 'normalize_original'
  | 'normalize_base64'
  | 'normalize_reference'

export type OutboundImageNormalizeErrorCode =
  | 'OUTBOUND_IMAGE_EMPTY_INPUT'
  | 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT'
  | 'OUTBOUND_IMAGE_UNSAFE_URL'
  | 'OUTBOUND_IMAGE_MEDIA_ROUTE_UNRESOLVED'
  | 'OUTBOUND_IMAGE_FETCH_FAILED'
  | 'OUTBOUND_IMAGE_FETCH_EXCEPTION'
  | 'OUTBOUND_IMAGE_REFERENCE_ALL_FAILED'

export class OutboundImageNormalizeError extends Error {
  readonly code: OutboundImageNormalizeErrorCode
  readonly stage: OutboundImageNormalizeStage
  readonly input: string

  constructor(params: {
    code: OutboundImageNormalizeErrorCode
    stage: OutboundImageNormalizeStage
    input: string
    message: string
  }) {
    super(params.message)
    this.name = 'OutboundImageNormalizeError'
    this.code = params.code
    this.stage = params.stage
    this.input = params.input
  }
}

export type OutboundImageNormalizationIssue = {
  index: number
  input: string
  code: OutboundImageNormalizeErrorCode | 'OUTBOUND_IMAGE_UNKNOWN'
  stage: OutboundImageNormalizeStage
  message: string
}

const logger = createScopedLogger({
  module: 'media.outbound-image',
})

const NEXT_IMAGE_PATH = '/_next/image'
const MAX_NEXT_IMAGE_UNWRAP_DEPTH = 6
const SIGNED_URL_TTL_SECONDS = 3600
const STORAGE_KEY_PREFIXES = ['images/', 'video/'] as const

let storageHelpersPromise: Promise<StorageHelpers> | null = null

async function getStorageHelpers(): Promise<StorageHelpers> {
  if (!storageHelpersPromise) {
    storageHelpersPromise = import('@/lib/storage').then((mod) => ({
      getSignedObjectUrl: mod.getSignedObjectUrl,
      toFetchableUrl: mod.toFetchableUrl,
    }))
  }
  return await storageHelpersPromise
}

function normalizeInput(input: string): string {
  const value = typeof input === 'string' ? input.trim() : ''
  if (!value) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_EMPTY_INPUT',
      stage: 'normalize_original',
      input: String(input ?? ''),
      message: 'outbound image input is empty',
    })
  }
  return value
}

function isDataUrl(value: string): boolean {
  return value.startsWith('data:')
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((part) => Number(part))
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return null
  return (((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3]) >>> 0
}

function isIpv4InRange(ip: string, cidr: { base: string; maskBits: number }): boolean {
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(cidr.base)
  if (ipInt === null || baseInt === null) return false
  const mask = cidr.maskBits === 0 ? 0 : (~((1 << (32 - cidr.maskBits)) - 1) >>> 0) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) {
    const ipv4Ranges: Array<{ base: string; maskBits: number }> = [
      { base: '0.0.0.0', maskBits: 8 },
      { base: '10.0.0.0', maskBits: 8 },
      { base: '100.64.0.0', maskBits: 10 },
      { base: '127.0.0.0', maskBits: 8 },
      { base: '169.254.0.0', maskBits: 16 },
      { base: '172.16.0.0', maskBits: 12 },
      { base: '192.0.0.0', maskBits: 24 },
      { base: '192.0.2.0', maskBits: 24 },
      { base: '192.88.99.0', maskBits: 24 },
      { base: '192.168.0.0', maskBits: 16 },
      { base: '198.18.0.0', maskBits: 15 },
      { base: '198.51.100.0', maskBits: 24 },
      { base: '203.0.113.0', maskBits: 24 },
      { base: '224.0.0.0', maskBits: 4 },
      { base: '240.0.0.0', maskBits: 4 },
      { base: '255.255.255.255', maskBits: 32 },
    ]
    return ipv4Ranges.some((range) => isIpv4InRange(ip, range))
  }

  if (family === 6) {
    const normalized = ip.toLowerCase()
    if (normalized === '::' || normalized === '::1') return true
    if (normalized.startsWith('ff')) return true
    if (/^(fc|fd)/.test(normalized)) return true
    if (/^fe[89ab]/.test(normalized)) return true
    if (normalized.startsWith('2001:db8')) return true
    const v4MappedIndex = normalized.lastIndexOf('::ffff:')
    if (v4MappedIndex !== -1) {
      const v4 = normalized.slice(v4MappedIndex + '::ffff:'.length)
      return isPrivateOrReservedIp(v4)
    }
    return false
  }

  return true
}

function isLikelyInternalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true
  if (lower.endsWith('.local')) return true
  if (lower === 'metadata.google.internal') return true
  if (lower === 'metadata' || lower === 'metadata.internal') return true
  return false
}

function isLoopbackHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '::1'
}

function readHostnameFromUrl(value: string): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

function getAllowedInternalHostnames(): Set<string> {
  const candidates: string[] = [
    getInternalBaseUrl(),
    process.env.INTERNAL_APP_URL || '',
    process.env.INTERNAL_TASK_API_BASE_URL || '',
    process.env.NEXTAUTH_URL || '',
  ]
  const hostnames = candidates
    .map(readHostnameFromUrl)
    .filter((item): item is string => Boolean(item))
  return new Set(hostnames)
}

async function assertSafeOutboundHttpUrl(input: string, stage: OutboundImageNormalizeStage): Promise<void> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
      stage,
      input,
      message: `invalid outbound http url: ${input}`,
    })
  }

  if (url.username || url.password) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage,
      input,
      message: 'outbound url with credentials is not allowed',
    })
  }

  const hostname = url.hostname.toLowerCase()
  const allowedInternalHosts = getAllowedInternalHostnames()
  if (allowedInternalHosts.has(hostname)) return
  if (isLoopbackHostname(hostname) && [...allowedInternalHosts].some(isLoopbackHostname)) return

  if (isLikelyInternalHostname(hostname)) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage,
      input,
      message: `outbound url hostname is not allowed: ${hostname}`,
    })
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new OutboundImageNormalizeError({
        code: 'OUTBOUND_IMAGE_UNSAFE_URL',
        stage,
        input,
        message: `outbound url resolves to private ip: ${hostname}`,
      })
    }
    return
  }

  let resolved: Array<{ address: string }> = []
  try {
    const lookupResult = await lookup(hostname, { all: true, verbatim: true }) as unknown
    const candidates = Array.isArray(lookupResult) ? lookupResult : [lookupResult]
    resolved = candidates
      .map((item): { address: string } | null => {
        if (!item || typeof item !== 'object') return null
        const address = (item as { address?: unknown }).address
        if (typeof address !== 'string' || !address.trim()) return null
        return { address: address.trim() }
      })
      .filter((item): item is { address: string } => item !== null)
  } catch (error) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage,
      input,
      message: `outbound url dns lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    })
  }

  if (resolved.length === 0) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage,
      input,
      message: 'outbound url dns lookup returned no results',
    })
  }

  const firstPrivate = resolved.find((item) => isPrivateOrReservedIp(item.address))
  if (firstPrivate) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSAFE_URL',
      stage,
      input,
      message: `outbound url resolves to private ip: ${firstPrivate.address}`,
    })
  }
}

function isAbsoluteOrRootPath(value: string): boolean {
  return isHttpUrl(value) || value.startsWith('/')
}

function isStorageKey(value: string): boolean {
  return STORAGE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function isNextImagePath(pathname: string): boolean {
  return pathname === NEXT_IMAGE_PATH || pathname.endsWith(NEXT_IMAGE_PATH)
}

function decodeRepeatedly(raw: string): string {
  let value = raw
  for (let i = 0; i < MAX_NEXT_IMAGE_UNWRAP_DEPTH; i += 1) {
    try {
      const decoded = decodeURIComponent(value)
      if (decoded === value) {
        break
      }
      value = decoded
    } catch {
      break
    }
  }
  return value
}

function normalizeUnwrappedTarget(raw: string): string {
  const value = decodeRepeatedly(raw).trim()
  if (!value) return value
  if (isAbsoluteOrRootPath(value) || isDataUrl(value) || isStorageKey(value)) return value
  if (value.startsWith('m/')) return `/${value}`
  if (value.startsWith('api/')) return `/${value}`
  return value
}

function toUrlMaybe(value: string): URL | null {
  try {
    if (isHttpUrl(value)) return new URL(value)
    if (value.startsWith('/')) return new URL(value, 'http://localhost')
  } catch {
    return null
  }
  return null
}

function guessContentType(input: string, contentTypeHeader: string | null, buffer: Uint8Array): string {
  return resolveMediaMimeType(input, contentTypeHeader, buffer)
}

async function signStorageKey(storageKey: string): Promise<string> {
  const { getSignedObjectUrl, toFetchableUrl } = await getStorageHelpers()
  return toFetchableUrl(await getSignedObjectUrl(storageKey, SIGNED_URL_TTL_SECONDS))
}

async function toFetchableAbsoluteUrl(value: string): Promise<string> {
  const { toFetchableUrl } = await getStorageHelpers()
  return toFetchableUrl(value)
}

function unwrapNextImageInternal(input: string): string {
  let current = input.trim()
  for (let i = 0; i < MAX_NEXT_IMAGE_UNWRAP_DEPTH; i += 1) {
    const parsed = toUrlMaybe(current)
    if (!parsed || !isNextImagePath(parsed.pathname)) {
      break
    }
    const wrapped = parsed.searchParams.get('url')
    if (!wrapped) {
      break
    }
    const unwrapped = normalizeUnwrappedTarget(wrapped)
    if (!unwrapped || unwrapped === current) {
      break
    }
    current = unwrapped
  }
  return current
}

async function normalizeMediaRouteUrl(input: string): Promise<string | null> {
  const parsed = toUrlMaybe(input)
  if (!parsed || !parsed.pathname.startsWith('/m/')) {
    return null
  }

  const mediaPath = parsed.pathname
  const storageKey = await resolveStorageKeyFromMediaValue(mediaPath)
  if (!storageKey) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_MEDIA_ROUTE_UNRESOLVED',
      stage: 'normalize_original',
      input,
      message: `failed to resolve /m route to storage key: ${mediaPath}`,
    })
  }

  return await signStorageKey(storageKey)
}

async function normalizeStorageSignRouteUrl(input: string): Promise<string | null> {
  const parsed = toUrlMaybe(input)
  if (!parsed || parsed.pathname !== '/api/storage/sign') {
    return null
  }
  const key = parsed.searchParams.get('key')?.trim()
  if (!key || !isStorageKey(key)) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
      stage: 'normalize_original',
      input,
      message: `unsupported storage sign route key: ${key || '<empty>'}`,
    })
  }
  return await signStorageKey(key)
}

export function unwrapNextImageDisplayUrl(input: string): string {
  return unwrapNextImageInternal(input)
}

export async function normalizeToOriginalMediaUrl(input: string): Promise<string> {
  const normalizedInput = normalizeInput(input)
  if (isDataUrl(normalizedInput)) {
    return normalizedInput
  }

  const unwrappedInput = unwrapNextImageInternal(normalizedInput)
  if (unwrappedInput !== normalizedInput) {
    return await normalizeToOriginalMediaUrl(unwrappedInput)
  }

  if (isStorageKey(unwrappedInput)) {
    return await signStorageKey(unwrappedInput)
  }

  const mediaRouteUrl = await normalizeMediaRouteUrl(unwrappedInput)
  if (mediaRouteUrl) {
    return mediaRouteUrl
  }

  const storageSignRouteUrl = await normalizeStorageSignRouteUrl(unwrappedInput)
  if (storageSignRouteUrl) {
    return storageSignRouteUrl
  }

  if (unwrappedInput.startsWith('/')) {
    if (unwrappedInput.startsWith('/api/')) {
      const apiPath = unwrappedInput
      return await toFetchableAbsoluteUrl(apiPath)
    }
    const rootStorageKey = unwrappedInput.slice(1)
    if (isStorageKey(rootStorageKey)) {
      return await signStorageKey(rootStorageKey)
    }
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
      stage: 'normalize_original',
      input: unwrappedInput,
      message: `unsupported root-relative outbound image input: ${unwrappedInput}`,
    })
  }

  if (isHttpUrl(unwrappedInput)) {
    await assertSafeOutboundHttpUrl(unwrappedInput, 'normalize_original')
    return unwrappedInput
  }

  const storageKey = await resolveStorageKeyFromMediaValue(unwrappedInput)
  if (storageKey) {
    return await signStorageKey(storageKey)
  }

  throw new OutboundImageNormalizeError({
    code: 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT',
    stage: 'normalize_original',
    input: unwrappedInput,
    message: `unsupported outbound image input: ${unwrappedInput}`,
  })
}

export async function normalizeToBase64ForGeneration(input: string): Promise<string> {
  const normalizedUrl = await normalizeToOriginalMediaUrl(input)
  if (isDataUrl(normalizedUrl)) {
    return normalizedUrl
  }

  const fetchUrl = await toFetchableAbsoluteUrl(normalizedUrl)
  const MAX_REDIRECTS = 3

  let response: Response | null = null
  try {
    let currentUrl = fetchUrl
    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
      if (isHttpUrl(currentUrl)) {
        await assertSafeOutboundHttpUrl(currentUrl, 'normalize_base64')
      }
      response = await fetch(currentUrl, { redirect: 'manual' })
      const status = response.status
      if (status >= 300 && status < 400) {
        const location = response.headers.get('location')
        if (!location) break
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }
      break
    }
  } catch (error) {
    if (error instanceof OutboundImageNormalizeError) {
      throw error
    }
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_FETCH_EXCEPTION',
      stage: 'normalize_base64',
      input: normalizedUrl,
      message: `normalizeToBase64ForGeneration fetch exception: ${fetchUrl}`,
    })
  }

  if (!response) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_FETCH_EXCEPTION',
      stage: 'normalize_base64',
      input: normalizedUrl,
      message: `normalizeToBase64ForGeneration missing response: ${fetchUrl}`,
    })
  }

  if (!response.ok) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_FETCH_FAILED',
      stage: 'normalize_base64',
      input: normalizedUrl,
      message: `normalizeToBase64ForGeneration fetch failed (${response.status}): ${fetchUrl}`,
    })
  }

  const buffer = await readResponseBufferWithLimit(response, MAX_IMAGE_BYTES, 'outbound image')
  const mimeType = guessContentType(normalizedUrl, response.headers.get('content-type'), buffer)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

/**
 * Worker-owned media is read directly from storage after the same relation-based
 * ownership decision used by the authenticated media routes. This avoids using
 * a browser session or a second internal-auth protocol for background work.
 */
export async function normalizeOwnedImageToBase64ForGeneration(
  input: string,
  userId: string,
): Promise<string> {
  const normalizedInput = normalizeInput(input)
  try {
    const media = await readOwnedMediaForGeneration(normalizedInput, userId, {
      maxBytes: MAX_IMAGE_BYTES,
      label: 'owned outbound image',
    })
    const mimeType = guessContentType(
      media.storageKey,
      media.declaredContentType,
      media.buffer,
    )
    return `data:${mimeType};base64,${media.buffer.toString('base64')}`
  } catch (error) {
    if (error instanceof OwnedMediaOutboundError) {
      throw new OutboundImageNormalizeError({
        code: error.code === 'OWNED_MEDIA_UNSUPPORTED_INPUT'
          ? 'OUTBOUND_IMAGE_UNSUPPORTED_INPUT'
          : 'OUTBOUND_IMAGE_FETCH_FAILED',
        stage: 'normalize_base64',
        input: normalizedInput,
        message: error.message,
      })
    }
    throw error
  }
}

function isOwnedStorageInputCandidate(input: string): boolean {
  const unwrapped = unwrapNextImageInternal(input)
  if (isStorageKey(unwrapped)) return true
  const parsed = toUrlMaybe(unwrapped)
  if (!parsed) return false
  return parsed.pathname.startsWith('/m/')
    || parsed.pathname.startsWith('/api/files/')
    || parsed.pathname === '/api/storage/sign'
}

async function normalizeReferenceForGeneration(input: string, ownerUserId?: string): Promise<string> {
  if (ownerUserId && isOwnedStorageInputCandidate(input)) {
    return await normalizeOwnedImageToBase64ForGeneration(input, ownerUserId)
  }
  return await normalizeToBase64ForGeneration(input)
}

function toNormalizationIssue(
  error: unknown,
  input: string,
  index: number,
): OutboundImageNormalizationIssue {
  if (error instanceof OutboundImageNormalizeError) {
    return {
      index,
      input,
      code: error.code,
      stage: error.stage,
      message: error.message,
    }
  }
  return {
    index,
    input,
    code: 'OUTBOUND_IMAGE_UNKNOWN',
    stage: 'normalize_reference',
    message: error instanceof Error ? error.message : String(error),
  }
}

export async function normalizeReferenceImagesForGeneration(
  inputs: string[],
  options: {
    onIssue?: (issue: OutboundImageNormalizationIssue) => void
    context?: Record<string, unknown>
    ownerUserId?: string
  } = {},
): Promise<string[]> {
  const seen = new Set<string>()
  const normalized: string[] = []
  let candidateCount = 0

  for (let index = 0; index < inputs.length; index += 1) {
    const item = inputs[index]
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    candidateCount += 1

    try {
      normalized.push(await normalizeReferenceForGeneration(trimmed, options.ownerUserId))
    } catch (error) {
      const issue = toNormalizationIssue(error, trimmed, index)
      options.onIssue?.(issue)
      logger.warn({
        message: 'reference image normalize failed',
        details: {
          ...issue,
          context: options.context || null,
        },
      })
    }
  }

  if (candidateCount > 0 && normalized.length === 0) {
    throw new OutboundImageNormalizeError({
      code: 'OUTBOUND_IMAGE_REFERENCE_ALL_FAILED',
      stage: 'normalize_reference',
      input: `candidates=${candidateCount}`,
      message: 'all reference images failed to normalize',
    })
  }

  return normalized
}

/**
 * 可选参考图归一化（fail-open）：
 * - 仅当“候选非空但全部归一化失败”时（OUTBOUND_IMAGE_REFERENCE_ALL_FAILED）返回 [] 并告警
 * - 其他异常照抛（保持显式失败）
 */
export async function normalizeOptionalReferenceImagesForGeneration(
  inputs: string[],
  options: {
    onIssue?: (issue: OutboundImageNormalizationIssue) => void
    context?: Record<string, unknown>
    ownerUserId?: string
  } = {},
): Promise<string[]> {
  try {
    return await normalizeReferenceImagesForGeneration(inputs, options)
  } catch (error) {
    if (error instanceof OutboundImageNormalizeError && error.code === 'OUTBOUND_IMAGE_REFERENCE_ALL_FAILED') {
      logger.warn({
        message: 'optional reference images all failed to normalize (fail-open)',
        details: {
          code: error.code,
          stage: error.stage,
          input: error.input,
          context: options.context || null,
        },
      })
      return []
    }
    throw error
  }
}

export function sanitizeImageInputsForTaskPayload(inputs: unknown[]): {
  normalized: string[]
  issues: OutboundImageInputIssue[]
} {
  const issues: OutboundImageInputIssue[] = []
  const normalized: string[] = []
  const seen = new Set<string>()

  for (let i = 0; i < inputs.length; i += 1) {
    const raw = inputs[i]
    if (typeof raw !== 'string') {
      issues.push({ index: i, input: raw, reason: 'non_string_skipped' })
      continue
    }

    const trimmed = raw.trim()
    if (!trimmed) {
      issues.push({ index: i, input: raw, reason: 'empty_value_skipped' })
      continue
    }

    const unwrapped = unwrapNextImageInternal(trimmed)
    if (unwrapped !== trimmed) {
      issues.push({ index: i, input: raw, normalized: unwrapped, reason: 'next_image_unwrapped' })
    }

    if (unwrapped.startsWith('/') && !unwrapped.startsWith('/m/') && !unwrapped.startsWith('/api/')) {
      issues.push({ index: i, input: raw, normalized: unwrapped, reason: 'relative_path_rejected' })
      continue
    }

    if (seen.has(unwrapped)) continue
    seen.add(unwrapped)
    normalized.push(unwrapped)
  }

  return { normalized, issues }
}
