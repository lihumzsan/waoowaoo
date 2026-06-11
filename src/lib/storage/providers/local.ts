import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import type {
  DeleteObjectsResult,
  GetObjectStreamParams,
  ObjectStreamResult,
  SignedUrlParams,
  StorageProvider,
  UploadObjectParams,
  UploadObjectResult,
} from '@/lib/storage/types'
import { normalizeKey, toFetchableUrl } from '@/lib/storage/utils'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads'

function resolveUploadPath(key: string): string {
  return path.join(process.cwd(), UPLOAD_DIR, normalizeKey(key))
}

function getMimeTypeFromKey(key: string): string | null {
  const ext = path.extname(key).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
  }
  return mimeTypes[ext] ?? null
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
}

function parseRange(range: string | null | undefined, size: number): { start: number; end: number } | null {
  if (!range) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd || '', 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }

  const start = Number.parseInt(rawStart, 10)
  const requestedEnd = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start < 0) return null

  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  }
}

export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'local' as const

  async uploadObject(params: UploadObjectParams): Promise<UploadObjectResult> {
    const normalizedKey = normalizeKey(params.key)
    const filePath = resolveUploadPath(normalizedKey)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, params.body)
    return { key: normalizedKey }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await fs.unlink(resolveUploadPath(key))
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code
      if (code !== 'ENOENT') {
        throw error
      }
    }
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    const validKeys = keys.filter((key) => typeof key === 'string' && key.trim().length > 0)
    let success = 0
    let failed = 0

    for (const key of validKeys) {
      try {
        await this.deleteObject(key)
        success += 1
      } catch {
        failed += 1
      }
    }

    return { success, failed }
  }

  async getSignedObjectUrl(params: SignedUrlParams): Promise<string> {
    void params.expiresInSeconds
    return `/api/files/${encodeURIComponent(normalizeKey(params.key))}`
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    return await fs.readFile(resolveUploadPath(key))
  }

  async getObjectStream(params: GetObjectStreamParams): Promise<ObjectStreamResult> {
    const normalizedKey = normalizeKey(params.key)
    const filePath = resolveUploadPath(normalizedKey)
    const stats = await fs.stat(filePath)
    const size = stats.size
    const contentType = getMimeTypeFromKey(normalizedKey)
    const range = parseRange(params.range, size)

    if (range && (range.start >= size || range.end < range.start)) {
      return {
        body: emptyStream(),
        contentType,
        contentLength: 0,
        contentRange: `bytes */${size}`,
        acceptRanges: 'bytes',
        statusCode: 416,
      }
    }

    const streamOptions = range ? { start: range.start, end: range.end } : undefined
    const nodeStream = createReadStream(filePath, streamOptions)
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
    const contentLength = range ? range.end - range.start + 1 : size

    return {
      body,
      contentType,
      contentLength,
      contentRange: range ? `bytes ${range.start}-${range.end}/${size}` : null,
      acceptRanges: 'bytes',
      statusCode: range ? 206 : 200,
    }
  }

  extractStorageKey(input: string | null | undefined): string | null {
    if (!input) return null
    if (input.startsWith('/api/files/')) {
      return normalizeKey(decodeURIComponent(input.replace('/api/files/', '')))
    }
    if (!input.startsWith('http') && !input.startsWith('/')) {
      return normalizeKey(input)
    }

    try {
      const parsed = new URL(input)
      return normalizeKey(parsed.pathname)
    } catch {
      return null
    }
  }

  toFetchableUrl(inputUrl: string): string {
    return toFetchableUrl(inputUrl)
  }

  generateUniqueKey(params: { prefix: string; ext: string }): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `images/${params.prefix}-${timestamp}-${random}.${params.ext}`
  }
}
