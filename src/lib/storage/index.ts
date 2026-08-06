import { createScopedLogger } from '@/lib/logging/core'
import { EXTERNAL_OPERATION } from '@/lib/external-operation/registry'
import { withRetry } from '@/lib/retry'
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
  contentType?: string,
): Promise<string> {
  const provider = getStorageProvider()

  const result = await withRetry({
    operation: EXTERNAL_OPERATION.STORAGE_PUT_SAME_OBJECT,
    scope: 'storage:upload',
    run: async () => {
      return await provider.uploadObject({ key, body, contentType })
    },
  })

  return result.key
}

export async function deleteObject(key: string): Promise<void> {
  await withRetry({
    operation: EXTERNAL_OPERATION.STORAGE_DELETE,
    run: async () => await getStorageProvider().deleteObject(key),
  })
}

export async function deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
  return await withRetry({
    operation: EXTERNAL_OPERATION.STORAGE_DELETE,
    run: async () => await getStorageProvider().deleteObjects(keys),
  })
}

export function extractStorageKey(input: string | null | undefined): string | null {
  return getStorageProvider().extractStorageKey(input)
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  return await withRetry({
    operation: EXTERNAL_OPERATION.STORAGE_READ,
    run: async () => await getStorageProvider().getObjectBuffer(key),
  })
}

export async function getObjectMetadata(key: string): Promise<ObjectMetadata> {
  return await withRetry({
    operation: EXTERNAL_OPERATION.STORAGE_READ,
    run: async () => await getStorageProvider().getObjectMetadata(key),
  })
}

export async function getObjectStream(params: GetObjectStreamParams): Promise<ObjectStreamResult> {
  return await withRetry({
    operation: EXTERNAL_OPERATION.STORAGE_READ,
    run: async () => await getStorageProvider().getObjectStream(params),
  })
}

export async function getSignedObjectUrl(key: string, expiresInSeconds: number = DEFAULT_SIGNED_URL_EXPIRES_SECONDS): Promise<string> {
  return await withRetry({
    operation: EXTERNAL_OPERATION.STORAGE_SIGN,
    run: async () => await getStorageProvider().getSignedObjectUrl({
      key,
      expiresInSeconds,
    }),
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
): Promise<string> {
  const sharp = (await import('sharp')).default

  const downloaded = await withRetry({
    operation: EXTERNAL_OPERATION.MEDIA_DOWNLOAD,
    scope: 'media:download-image',
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
      return { body: processed, key: jpgKey }
    },
  })
  return await uploadObject(downloaded.body, downloaded.key, 'image/jpeg')
}

export async function downloadAndUploadVideo(
  videoUrl: string,
  key: string,
  requestHeaders?: Record<string, string>,
): Promise<string> {
  const downloaded = await withRetry({
    operation: EXTERNAL_OPERATION.MEDIA_DOWNLOAD,
    scope: 'media:download-video',
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
      return { body: buffer, contentType }
    },
  })
  return await uploadObject(downloaded.body, key, downloaded.contentType)
}

export * from './signed-urls'
