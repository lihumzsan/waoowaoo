import { generateUniqueKey, toFetchableUrl, uploadObject, uploadObjectStream } from '@/lib/storage'
import sharp from 'sharp'

export interface ProcessMediaOptions {
  source: string | Buffer
  type: 'image' | 'video' | 'audio'
  keyPrefix: string
  targetId: string
  downloadHeaders?: Record<string, string>
}

export interface ProcessRemoteMediaStreamOptions {
  source: string
  type: 'video'
  keyPrefix: string
  targetId: string
  contentLength?: number
  mimeType?: string
  downloadHeaders?: Record<string, string>
}

export type ProcessedMediaMetadata = {
  mimeType: string
  sizeBytes: number
  width?: number | null
  height?: number | null
  durationMs?: number | null
}

export type ProcessedMediaResult = {
  storageKey: string
  metadata: ProcessedMediaMetadata
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
}

export function resolveMediaContentType(ext: string): string {
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

function detectImageExtFromBuffer(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png'
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return 'gif'
  }
  return null
}

function normalizeImageExtFromMime(mimeType: string | null): 'jpg' | 'png' | 'webp' | 'gif' | null {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  return null
}

function detectVideoExtFromBuffer(buffer: Buffer): 'mp4' | 'webm' | null {
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4'
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'webm'
  return null
}

function normalizeVideoExtFromMime(mimeType: string | null): 'mp4' | 'webm' | null {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalized === 'video/mp4' || normalized === 'video/quicktime') return 'mp4'
  if (normalized === 'video/webm') return 'webm'
  return null
}

function detectAudioExtFromBuffer(buffer: Buffer): 'mp3' | 'wav' | 'ogg' | 'flac' | null {
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'mp3'
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3'
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'wav'
  }
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC') return 'flac'
  return null
}

function normalizeAudioExtFromMime(mimeType: string | null): 'mp3' | 'wav' | 'ogg' | 'm4a' | 'flac' | 'aac' | null {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') return 'mp3'
  if (normalized === 'audio/wav' || normalized === 'audio/wave' || normalized === 'audio/x-wav') return 'wav'
  if (normalized === 'audio/ogg' || normalized === 'application/ogg') return 'ogg'
  if (normalized === 'audio/mp4' || normalized === 'audio/m4a' || normalized === 'audio/x-m4a') return 'm4a'
  if (normalized === 'audio/flac' || normalized === 'audio/x-flac') return 'flac'
  if (normalized === 'audio/aac' || normalized === 'audio/x-aac') return 'aac'
  return null
}

export function resolveMediaExt(
  type: ProcessMediaOptions['type'],
  buffer: Buffer,
  mimeHint: string | null,
): string {
  if (type === 'image') return detectImageExtFromBuffer(buffer) || normalizeImageExtFromMime(mimeHint) || 'jpg'
  if (type === 'video') return detectVideoExtFromBuffer(buffer) || normalizeVideoExtFromMime(mimeHint) || 'mp4'
  return detectAudioExtFromBuffer(buffer) || normalizeAudioExtFromMime(mimeHint) || 'mp3'
}

function readStreamContentLength(rawValue: string | null): number | undefined {
  if (rawValue === null) return undefined
  const value = rawValue.trim()
  if (!/^\d+$/.test(value)) {
    throw new Error('REMOTE_MEDIA_STREAM_CONTENT_LENGTH_INVALID')
  }
  const contentLength = Number(value)
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new Error('REMOTE_MEDIA_STREAM_CONTENT_LENGTH_INVALID')
  }
  return contentLength
}

function resolveRemoteVideoMimeType(response: Response, mimeHint?: string): string {
  const responseMime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (responseMime && responseMime !== 'application/octet-stream') {
    if (!normalizeVideoExtFromMime(responseMime)) {
      throw new Error('REMOTE_MEDIA_STREAM_MIME_INVALID')
    }
    return responseMime
  }

  const normalizedHint = mimeHint?.split(';')[0]?.trim().toLowerCase()
  if (normalizedHint) {
    if (!normalizeVideoExtFromMime(normalizedHint)) {
      throw new Error('REMOTE_MEDIA_STREAM_MIME_INVALID')
    }
    return normalizedHint
  }
  return 'video/mp4'
}

export async function processRemoteMediaStream(options: ProcessRemoteMediaStreamOptions): Promise<string> {
  const expectedLength = options.contentLength
  if (expectedLength !== undefined && (!Number.isSafeInteger(expectedLength) || expectedLength <= 0)) {
    throw new Error('REMOTE_MEDIA_STREAM_CONTENT_LENGTH_INVALID')
  }

  const response = await fetch(toFetchableUrl(options.source), {
    headers: options.downloadHeaders,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  })
  const responseBody = response.body
  try {
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`REMOTE_MEDIA_STREAM_FETCH_FAILED: ${response.status} ${detail.slice(0, 200)}`)
    }
    if (!responseBody) {
      throw new Error('REMOTE_MEDIA_STREAM_BODY_MISSING')
    }

    const responseLength = readStreamContentLength(response.headers.get('content-length'))
    const contentLength = responseLength ?? expectedLength
    if (contentLength === undefined) {
      throw new Error('REMOTE_MEDIA_STREAM_CONTENT_LENGTH_MISSING')
    }
    if (responseLength !== undefined && expectedLength !== undefined && responseLength !== expectedLength) {
      throw new Error('REMOTE_MEDIA_STREAM_CONTENT_LENGTH_MISMATCH')
    }

    const mimeType = resolveRemoteVideoMimeType(response, options.mimeType)
    const ext = normalizeVideoExtFromMime(mimeType) || 'mp4'
    const key = generateUniqueKey(`${options.keyPrefix}-${options.targetId}`, ext)
    return await uploadObjectStream(responseBody, key, contentLength, mimeType)
  } catch (error) {
    await responseBody?.cancel().catch(() => undefined)
    throw error
  }
}

async function inspectMediaMetadata(
  buffer: Buffer,
  type: ProcessMediaOptions['type'],
  mimeType: string,
): Promise<ProcessedMediaMetadata> {
  const metadata: ProcessedMediaMetadata = {
    mimeType,
    sizeBytes: buffer.byteLength,
  }

  if (type !== 'image') return metadata

  try {
    const imageMetadata = await sharp(buffer).metadata()
    metadata.width = imageMetadata.width ?? null
    metadata.height = imageMetadata.height ?? null
  } catch {
    metadata.width = null
    metadata.height = null
  }

  return metadata
}

async function uploadTypedBufferWithMetadata(
  buffer: Buffer,
  type: ProcessMediaOptions['type'],
  keyPrefix: string,
  targetId: string,
  mimeHint: string | null = null,
): Promise<ProcessedMediaResult> {
  const ext = resolveMediaExt(type, buffer, mimeHint)
  const key = generateUniqueKey(`${keyPrefix}-${targetId}`, ext)
  const mimeType = resolveMediaContentType(ext)
  const storageKey = await uploadObject(buffer, key, undefined, mimeType)
  return {
    storageKey,
    metadata: await inspectMediaMetadata(buffer, type, mimeType),
  }
}

async function uploadTypedBuffer(
  buffer: Buffer,
  type: ProcessMediaOptions['type'],
  keyPrefix: string,
  targetId: string,
  mimeHint: string | null = null,
) {
  return (await uploadTypedBufferWithMetadata(buffer, type, keyPrefix, targetId, mimeHint)).storageKey
}

export async function processMediaResult(options: ProcessMediaOptions): Promise<string> {
  const { source, type, keyPrefix, targetId, downloadHeaders } = options

  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      const base64Start = source.indexOf(';base64,')
      if (base64Start === -1) throw new Error('Unable to parse data URL')
      const mimeHint = source.slice(5, base64Start) || null
      const base64Data = source.substring(base64Start + 8)
      const buffer = Buffer.from(base64Data, 'base64') as Buffer
      return await uploadTypedBuffer(buffer, type, keyPrefix, targetId, mimeHint)
    }

    const response = await fetch(toFetchableUrl(source), {
      headers: downloadHeaders,
    })
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status} ${response.statusText}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer()) as Buffer
    return await uploadTypedBuffer(buffer, type, keyPrefix, targetId, response.headers.get('content-type'))
  }

  return await uploadTypedBuffer(source, type, keyPrefix, targetId)
}

export async function processMediaResultWithMetadata(options: ProcessMediaOptions): Promise<ProcessedMediaResult> {
  const { source, type, keyPrefix, targetId, downloadHeaders } = options

  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      const base64Start = source.indexOf(';base64,')
      if (base64Start === -1) throw new Error('Unable to parse data URL')
      const mimeHint = source.slice(5, base64Start) || null
      const base64Data = source.substring(base64Start + 8)
      const buffer = Buffer.from(base64Data, 'base64') as Buffer
      return await uploadTypedBufferWithMetadata(buffer, type, keyPrefix, targetId, mimeHint)
    }

    const response = await fetch(toFetchableUrl(source), {
      headers: downloadHeaders,
    })
    if (!response.ok) {
      throw new Error(`Failed to download media: ${response.status} ${response.statusText}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer()) as Buffer
    return await uploadTypedBufferWithMetadata(buffer, type, keyPrefix, targetId, response.headers.get('content-type'))
  }

  return await uploadTypedBufferWithMetadata(source, type, keyPrefix, targetId)
}
