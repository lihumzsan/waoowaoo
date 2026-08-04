import { createScopedLogger } from '@/lib/logging/core'
import { RETRY_POLICY, withRetry } from '@/lib/retry'
import { S3StorageProvider } from '@/lib/storage/providers/s3'
import type {
  DeleteObjectsResult,
  GetObjectStreamParams,
  ObjectMetadata,
  ObjectStreamResult,
  StorageProvider,
} from '@/lib/storage/types'
import { DEFAULT_SIGNED_URL_EXPIRES_SECONDS } from '@/lib/storage/utils'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, readResponseBufferWithLimit } from '@/lib/http/body-limits'
import { fetchSafeOutboundMedia } from '@/lib/media/outbound-fetch'

const storageLogger = createScopedLogger({
  module: 'storage.provider',
})

const UPLOAD_MAX_RETRIES = 3
let providerSingleton: StorageProvider | null = null

export function getStorageProvider(): StorageProvider {
  if (!providerSingleton) {
    providerSingleton = new S3StorageProvider()
    storageLogger.info(`[Storage] provider initialized: ${providerSingleton.kind}`)
  }
  return providerSingleton
}

export function toFetchableUrl(inputUrl: string): string {
  return getStorageProvider().toFetchableUrl(inputUrl)
}

export function generateUniqueKey(prefix: string, ext: string = 'png'): string {
  return getStorageProvider().generateUniqueKey({ prefix, ext })
}

export async function uploadObject(
  body: Buffer,
  key: string,
  retryAttempts: number = UPLOAD_MAX_RETRIES,
  contentType?: string,
): Promise<string> {
  const provider = getStorageProvider()

  const result = await withRetry({
    scope: 'storage:upload',
    policy: {
      ...RETRY_POLICY.storage,
      maxAttempts: Math.max(1, Math.floor(retryAttempts)),
    },
    run: async () => {
      return await provider.uploadObject({ key, body, contentType })
    },
  })

  return result.key
}

export async function deleteObject(key: string): Promise<void> {
  await getStorageProvider().deleteObject(key)
}

export async function deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
  return await getStorageProvider().deleteObjects(keys)
}

export function extractStorageKey(input: string | null | undefined): string | null {
  return getStorageProvider().extractStorageKey(input)
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  return await getStorageProvider().getObjectBuffer(key)
}

export async function getObjectMetadata(key: string): Promise<ObjectMetadata> {
  return await getStorageProvider().getObjectMetadata(key)
}

export async function getObjectStream(params: GetObjectStreamParams): Promise<ObjectStreamResult> {
  return await getStorageProvider().getObjectStream(params)
}

export async function getSignedObjectUrl(key: string, expiresInSeconds: number = DEFAULT_SIGNED_URL_EXPIRES_SECONDS): Promise<string> {
  return await getStorageProvider().getSignedObjectUrl({
    key,
    expiresInSeconds,
  })
}

export function getSignedUrl(key: string, expiresInSeconds: number = DEFAULT_SIGNED_URL_EXPIRES_SECONDS): string {
  return `/api/storage/sign?key=${encodeURIComponent(key)}&expires=${encodeURIComponent(String(expiresInSeconds))}`
}

export function getSignedUrls(keys: string[], expiresInSeconds: number = DEFAULT_SIGNED_URL_EXPIRES_SECONDS): string[] {
  return keys.map((key) => getSignedUrl(key, expiresInSeconds))
}

export async function downloadAndUploadImage(
  imageUrl: string,
  key: string,
  retryAttempts: number = UPLOAD_MAX_RETRIES,
): Promise<string> {
  const sharp = (await import('sharp')).default

  return await withRetry({
    scope: 'storage:download-image',
    policy: {
      ...RETRY_POLICY.storage,
      maxAttempts: Math.max(1, Math.floor(retryAttempts)),
    },
    run: async () => {
      const response = await fetchSafeOutboundMedia(toFetchableUrl(imageUrl))
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
      }

      const buffer = await readResponseBufferWithLimit(response, MAX_IMAGE_BYTES, 'storage image download')
      let processed = await sharp(buffer).jpeg({ quality: 95, mozjpeg: true }).toBuffer()
      let quality = 95
      const maxSizeBytes = 10 * 1024 * 1024

      while (processed.length > maxSizeBytes && quality > 60) {
        quality -= 5
        processed = await sharp(buffer).jpeg({ quality, mozjpeg: true }).toBuffer()
      }

      const jpgKey = key.replace(/\.(png|webp)$/i, '.jpg')
      return await uploadObject(processed, jpgKey, 1, 'image/jpeg')
    },
  })
}

export async function downloadAndUploadVideo(
  videoUrl: string,
  key: string,
  retryAttempts: number = UPLOAD_MAX_RETRIES,
  requestHeaders?: Record<string, string>,
): Promise<string> {
  return await withRetry({
    scope: 'storage:download-video',
    policy: {
      ...RETRY_POLICY.storage,
      maxAttempts: Math.max(1, Math.floor(retryAttempts)),
    },
    run: async () => {
      const response = await fetchSafeOutboundMedia(toFetchableUrl(videoUrl), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VideoDownloader/1.0)',
          ...(requestHeaders || {}),
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.status} ${response.statusText}`)
      }

      const buffer = await readResponseBufferWithLimit(response, MAX_VIDEO_BYTES, 'storage video download')
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4'
      return await uploadObject(buffer, key, 1, contentType)
    },
  })
}

export * from './signed-urls'
