import { describeUnknownError } from '@/lib/errors/normalize'
import { resolveMediaMimeType } from '@/lib/media/media-mime'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { authorizeStorageObjectReadForUser } from '@/lib/media/storage-access-policy'
import { DEFAULT_SIGNED_URL_EXPIRES_SECONDS } from '@/lib/storage/utils'
import { getObjectMetadata, getSignedObjectUrl } from '@/lib/storage'

function storageErrorSummary(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return describeUnknownError(error)
}

export type OwnedMediaOutboundErrorCode =
  | 'OWNED_MEDIA_UNSUPPORTED_INPUT'
  | 'OWNED_MEDIA_STORAGE_METADATA_FAILED'
  | 'OWNED_MEDIA_SIZE_UNKNOWN'
  | 'OWNED_MEDIA_EMPTY'
  | 'OWNED_MEDIA_SIZE_EXCEEDED'
  | 'OWNED_MEDIA_FORMAT_UNSUPPORTED'
  | 'OWNED_MEDIA_SIGNED_URL_INVALID'

export class OwnedMediaOutboundError extends Error {
  readonly code: OwnedMediaOutboundErrorCode
  readonly input: string

  constructor(input: {
    code: OwnedMediaOutboundErrorCode
    mediaInput: string
    message: string
  }) {
    super(input.message)
    this.name = 'OwnedMediaOutboundError'
    this.code = input.code
    this.input = input.mediaInput
  }
}

export type OwnedMediaForGeneration = {
  readonly url: string
  readonly storageKey: string
  readonly contentType: string
  readonly sizeBytes: number
  readonly durationMs: number | null
}

/**
 * The only background-task projection path for private provider-bound media.
 * It resolves canonical storage identity, applies the same relation owner
 * policy as authenticated media routes, validates object metadata, and issues
 * a bounded HTTPS URL without a browser route, cookie, or internal credential.
 */
export async function resolveOwnedMediaForGeneration(
  input: string,
  userId: string,
  options: {
    readonly maxBytes: number
    readonly label: string
    readonly supportedMimeTypes: ReadonlySet<string>
    readonly normalizeMimeType?: (mimeType: string) => string
  },
): Promise<OwnedMediaForGeneration> {
  const normalizedInput = input.trim()
  const storageKey = await resolveStorageKeyFromMediaValue(normalizedInput)
  if (!storageKey) {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_UNSUPPORTED_INPUT',
      mediaInput: normalizedInput,
      message: `owned media input does not resolve to a storage key: ${normalizedInput}`,
    })
  }

  const media = await authorizeStorageObjectReadForUser(storageKey, userId)
  let objectMetadata
  try {
    objectMetadata = await getObjectMetadata(media.storageKey)
  } catch (error) {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_STORAGE_METADATA_FAILED',
      mediaInput: normalizedInput,
      message: `${options.label} metadata read failed for ${media.storageKey}: ${storageErrorSummary(error)}`,
    })
  }

  const storedSize = typeof media.sizeBytes === 'bigint'
    ? Number(media.sizeBytes)
    : media.sizeBytes
  const sizeBytes = objectMetadata.contentLength ?? storedSize
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_SIZE_UNKNOWN',
      mediaInput: normalizedInput,
      message: `${options.label} size is unavailable: ${media.storageKey}`,
    })
  }
  if (sizeBytes === 0) {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_EMPTY',
      mediaInput: normalizedInput,
      message: `${options.label} is empty: ${media.storageKey}`,
    })
  }
  if (sizeBytes > options.maxBytes) {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_SIZE_EXCEEDED',
      mediaInput: normalizedInput,
      message: `${options.label} exceeds ${String(options.maxBytes)} bytes: ${media.storageKey}`,
    })
  }

  const storageContentType = resolveMediaMimeType(
    media.storageKey,
    objectMetadata.contentType,
    new Uint8Array(),
  )
  const detectedContentType = storageContentType === 'application/octet-stream' && media.mimeType
    ? resolveMediaMimeType(media.storageKey, media.mimeType, new Uint8Array())
    : storageContentType
  const contentType = options.normalizeMimeType
    ? options.normalizeMimeType(detectedContentType)
    : detectedContentType
  if (!options.supportedMimeTypes.has(contentType)) {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_FORMAT_UNSUPPORTED',
      mediaInput: normalizedInput,
      message: `${options.label} format is unsupported: ${contentType}`,
    })
  }

  const url = await getSignedObjectUrl(media.storageKey, DEFAULT_SIGNED_URL_EXPIRES_SECONDS)
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_SIGNED_URL_INVALID',
      mediaInput: normalizedInput,
      message: `${options.label} signed URL is invalid`,
    })
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_SIGNED_URL_INVALID',
      mediaInput: normalizedInput,
      message: `${options.label} signed URL must use HTTPS`,
    })
  }
  return {
    url: parsedUrl.toString(),
    storageKey: media.storageKey,
    contentType,
    sizeBytes,
    durationMs: media.durationMs,
  }
}
