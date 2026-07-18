import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  DeleteObjectsResult,
  SignedUrlParams,
  StorageProvider,
  UploadObjectParams,
  UploadObjectResult,
  UploadObjectStreamParams,
} from '@/lib/storage/types'
import { normalizeKey, toFetchableUrl } from '@/lib/storage/utils'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads'

function resolveStorageKey(key: string): { normalizedKey: string; filePath: string } {
  const normalizedKey = normalizeKey(key)
  const validationKey = normalizedKey.replace(/\\/g, '/')
  if (
    !normalizedKey
    || normalizedKey.includes('\0')
    || normalizedKey.includes('\\')
    || validationKey.split('/').includes('..')
  ) {
    throw new Error('STORAGE_KEY_INVALID')
  }

  const uploadRoot = path.resolve(process.cwd(), UPLOAD_DIR)
  const filePath = path.resolve(uploadRoot, normalizedKey)
  if (filePath === uploadRoot || !filePath.startsWith(`${uploadRoot}${path.sep}`)) {
    throw new Error('STORAGE_KEY_INVALID')
  }
  return { normalizedKey, filePath }
}

export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'local' as const

  async uploadObject(params: UploadObjectParams): Promise<UploadObjectResult> {
    const { normalizedKey, filePath } = resolveStorageKey(params.key)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, params.body)
    return { key: normalizedKey }
  }

  async uploadObjectStream(params: UploadObjectStreamParams): Promise<UploadObjectResult> {
    const { normalizedKey, filePath } = resolveStorageKey(params.key)
    const destinationDirectory = path.dirname(filePath)
    await fs.mkdir(destinationDirectory, { recursive: true })
    const tempPath = path.join(
      destinationDirectory,
      `.${path.basename(filePath)}.${randomUUID()}.tmp`,
    )

    let receivedLength = 0
    const lengthValidator = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedLength += chunk.byteLength
        if (receivedLength > params.contentLength) {
          callback(new Error('STORAGE_STREAM_LENGTH_MISMATCH'))
          return
        }
        callback(null, chunk)
      },
      flush(callback) {
        callback(receivedLength === params.contentLength
          ? undefined
          : new Error('STORAGE_STREAM_LENGTH_MISMATCH'))
      },
    })
    try {
      await pipeline(
        Readable.fromWeb(params.body as unknown as import('node:stream/web').ReadableStream),
        lengthValidator,
        createWriteStream(tempPath, { flags: 'wx' }),
      )
      await fs.rename(tempPath, filePath)
      return { key: normalizedKey }
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await fs.unlink(resolveStorageKey(key).filePath)
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
    return `/api/files/${encodeURIComponent(resolveStorageKey(params.key).normalizedKey)}`
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    return await fs.readFile(resolveStorageKey(key).filePath)
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
