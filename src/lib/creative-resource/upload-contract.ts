import { z } from 'zod'
import type { CreativeResourceMediaType } from './contracts'
import { creativeResourceGenerationOptionsSchema } from './generation-contract'
import { CREATIVE_RESOURCE_SCHEMA, type CreativeResourceSchemaId } from './schema-registry'

export const USER_UPLOAD_SOURCE_TYPE = 'user_upload'

/**
 * The exhaustive vocabulary of user-uploadable media. Acceptance is decided by
 * sniffed magic bytes, never by file extension or client-declared MIME; a type
 * missing here fails closed. Video upload is deliberately not offered.
 */
export const USER_UPLOAD_ACCEPTED_MEDIA = {
  'image/png': { mediaType: 'image', extension: 'png' },
  'image/jpeg': { mediaType: 'image', extension: 'jpg' },
  'image/webp': { mediaType: 'image', extension: 'webp' },
  'audio/mpeg': { mediaType: 'audio', extension: 'mp3' },
  'audio/wav': { mediaType: 'audio', extension: 'wav' },
  'audio/ogg': { mediaType: 'audio', extension: 'ogg' },
} as const satisfies Record<string, {
  readonly mediaType: CreativeResourceMediaType
  readonly extension: string
}>

export type UserUploadAcceptedMimeType = keyof typeof USER_UPLOAD_ACCEPTED_MEDIA
export type UserUploadMediaType = typeof USER_UPLOAD_ACCEPTED_MEDIA[UserUploadAcceptedMimeType]['mediaType']

export function resolveUserUploadAcceptedMedia(
  sniffedMimeType: string | null,
): { readonly mimeType: UserUploadAcceptedMimeType; readonly mediaType: UserUploadMediaType; readonly extension: string } | null {
  if (!sniffedMimeType) return null
  const accepted = USER_UPLOAD_ACCEPTED_MEDIA[sniffedMimeType as UserUploadAcceptedMimeType]
  if (!accepted) return null
  return {
    mimeType: sniffedMimeType as UserUploadAcceptedMimeType,
    mediaType: accepted.mediaType,
    extension: accepted.extension,
  }
}

export function userUploadSchemaIdForMediaType(mediaType: UserUploadMediaType): CreativeResourceSchemaId {
  return mediaType === 'image'
    ? CREATIVE_RESOURCE_SCHEMA.UPLOAD_IMAGE
    : CREATIVE_RESOURCE_SCHEMA.UPLOAD_AUDIO
}

/**
 * Content-addressed key: the same bytes always land on the same object, so a
 * re-upload or a crash retry overwrites an identical object instead of
 * creating an orphan, and the MediaObject row is reused by storageKey.
 */
export function buildUserUploadStorageKey(input: {
  readonly sha256: string
  readonly extension: string
}): string {
  const sha256 = input.sha256.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('USER_UPLOAD_SHA256_INVALID')
  return `images/uploads/${sha256}.${input.extension}`
}

/**
 * One Resource per distinct content per project: the domain origin is the
 * content hash scoped to the owning project, so the same file uploaded twice
 * converges to the same Resource instead of a duplicate.
 */
export function buildUserUploadSourceId(input: {
  readonly projectId: string
  readonly sha256: string
}): string {
  const projectId = input.projectId.trim()
  if (!projectId) throw new Error('USER_UPLOAD_PROJECT_ID_REQUIRED')
  return `${projectId}:${input.sha256.trim().toLowerCase()}`
}

/**
 * Upload provenance is frozen into the Revision: the original file name and
 * content hash are the only durable answer to "where did this material come
 * from", since no prompt, model, or task exists for a user upload.
 */
export const userUploadProvenanceSchema = creativeResourceGenerationOptionsSchema
  .superRefine((options, context) => {
    const required = z.object({
      origin: z.literal(USER_UPLOAD_SOURCE_TYPE),
      fileName: z.string().min(1).max(500),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      mimeType: z.string().min(1),
      sizeBytes: z.number().int().positive(),
    })
    if (!required.safeParse(options).success) {
      context.addIssue({ code: 'custom', message: 'USER_UPLOAD_PROVENANCE_REQUIRED' })
    }
  })

export function buildUserUploadProvenance(input: {
  readonly fileName: string
  readonly sha256: string
  readonly mimeType: string
  readonly sizeBytes: number
}): Record<string, string | number> {
  return {
    origin: USER_UPLOAD_SOURCE_TYPE,
    fileName: input.fileName,
    sha256: input.sha256.trim().toLowerCase(),
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  }
}
