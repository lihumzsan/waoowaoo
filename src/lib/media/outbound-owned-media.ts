import { readResponseBufferWithLimit } from '@/lib/http/body-limits'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { authorizeStorageObjectReadForUser } from '@/lib/media/storage-access-policy'
import { getObjectStream } from '@/lib/storage'

export type OwnedMediaOutboundErrorCode =
  | 'OWNED_MEDIA_UNSUPPORTED_INPUT'
  | 'OWNED_MEDIA_STORAGE_READ_FAILED'

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
  readonly buffer: Buffer
  readonly storageKey: string
  readonly declaredContentType: string | null
  readonly durationMs: number | null
}

/**
 * The only background-task read path for private provider-bound media.
 * It resolves canonical storage identity, applies the same relation owner
 * policy as authenticated media routes, and reads storage without a browser
 * route, cookie, or internal HTTP credential.
 */
export async function readOwnedMediaForGeneration(
  input: string,
  userId: string,
  options: {
    readonly maxBytes: number
    readonly label: string
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
  const object = await getObjectStream({ key: media.storageKey })
  if (object.statusCode < 200 || object.statusCode >= 300) {
    throw new OwnedMediaOutboundError({
      code: 'OWNED_MEDIA_STORAGE_READ_FAILED',
      mediaInput: normalizedInput,
      message: `owned media storage read failed (${object.statusCode}): ${media.storageKey}`,
    })
  }

  const declaredContentType = media.mimeType || object.contentType
  const headers = new Headers()
  if (declaredContentType) headers.set('content-type', declaredContentType)
  if (object.contentLength != null) headers.set('content-length', String(object.contentLength))
  const response = new Response(object.body, { status: object.statusCode, headers })

  return {
    buffer: await readResponseBufferWithLimit(response, options.maxBytes, options.label),
    storageKey: media.storageKey,
    declaredContentType,
    durationMs: media.durationMs,
  }
}
