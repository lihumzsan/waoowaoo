import type { Prisma } from '@prisma/client'
import { readStoredImageFacts } from '@/lib/media/stored-image-facts'
import { prisma } from '@/lib/prisma'
import { StorageObjectSizeExceededError } from '@/lib/storage/errors'
import { resolveUserUploadAcceptedMedia } from '@/lib/workspace-resource/upload-contract'
import {
  verifyProjectAssistantAttachmentToken,
  type ProjectAssistantAttachmentTokenPayload,
} from './attachment-token'
import type { ProjectAssistantMediaAttachment } from './types'

type MediaAttachmentReadClient = Pick<Prisma.TransactionClient, 'mediaObject'> | typeof prisma

export interface ResolvedProjectAssistantAttachmentRegistration {
  readonly payload: ProjectAssistantAttachmentTokenPayload
  readonly media: {
    readonly id: string
    readonly publicId: string
    readonly storageKey: string
    readonly sha256: string | null
    readonly mimeType: string | null
    readonly sizeBytes: number | null
  }
}

export async function resolveProjectAssistantImageAttachmentDataUrl(input: {
  readonly userId: string
  readonly projectId: string
  readonly attachmentToken: string
}): Promise<string> {
  const registration = await resolveProjectAssistantAttachmentRegistration(input)
  if (registration.payload.mediaType !== 'image') {
    throw new Error(
      `PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MEDIA_TYPE_INVALID:${registration.payload.publicId}`,
    )
  }
  let storedImage: Awaited<ReturnType<typeof readStoredImageFacts>>
  try {
    storedImage = await readStoredImageFacts(registration.media.storageKey)
  } catch (error) {
    if (error instanceof StorageObjectSizeExceededError) {
      throw new Error(
        `PROJECT_ASSISTANT_MEDIA_ATTACHMENT_SIZE_EXCEEDED:${registration.payload.publicId}`,
        { cause: error },
      )
    }
    throw error
  }
  const accepted = resolveUserUploadAcceptedMedia(storedImage.mimeType)
  if (!accepted || accepted.mediaType !== 'image') {
    throw new Error(
      `PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MEDIA_TYPE_INVALID:${registration.payload.publicId}`,
    )
  }
  if (storedImage.sha256 !== registration.payload.sha256) {
    throw new Error(
      `PROJECT_ASSISTANT_MEDIA_ATTACHMENT_CONTENT_MISMATCH:${registration.payload.publicId}`,
    )
  }
  return `data:${accepted.mimeType};base64,${storedImage.bytes.toString('base64')}`
}

/**
 * The single server-side authority for chat attachment registrations. Message
 * acceptance, model-input projection and the materialization operation all
 * resolve an attachment through here: verify the signed token against the
 * authenticated user/project, then prove the registered MediaObject still
 * exists and matches the frozen media facts. Every failure is a typed error;
 * nothing is skipped silently.
 */
export async function resolveProjectAssistantAttachmentRegistration(input: {
  readonly userId: string
  readonly projectId: string
  readonly attachmentToken: string
  readonly client?: MediaAttachmentReadClient
}): Promise<ResolvedProjectAssistantAttachmentRegistration> {
  const payload = verifyProjectAssistantAttachmentToken(input.attachmentToken, {
    userId: input.userId,
    projectId: input.projectId,
  })
  const client = input.client ?? prisma
  const media = await client.mediaObject.findUnique({
    where: { publicId: payload.publicId },
    select: {
      id: true,
      publicId: true,
      storageKey: true,
      sha256: true,
      mimeType: true,
      sizeBytes: true,
    },
  })
  if (!media) {
    throw new Error(`PROJECT_ASSISTANT_MEDIA_ATTACHMENT_OBJECT_MISSING:${payload.publicId}`)
  }
  const accepted = resolveUserUploadAcceptedMedia(media.mimeType)
  if (!accepted || accepted.mediaType !== payload.mediaType) {
    throw new Error(`PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MEDIA_TYPE_INVALID:${payload.publicId}`)
  }
  if (media.sha256 && media.sha256.toLowerCase() !== payload.sha256) {
    throw new Error(`PROJECT_ASSISTANT_MEDIA_ATTACHMENT_CONTENT_MISMATCH:${payload.publicId}`)
  }
  return {
    payload,
    media: {
      id: media.id,
      publicId: media.publicId,
      storageKey: media.storageKey,
      sha256: media.sha256,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes == null ? null : Number(media.sizeBytes),
    },
  }
}

/**
 * Server-side authority for message media attachments at acceptance time:
 * every ref must carry a valid registration token scoped to the authenticated
 * user and project, and the persisted metadata is rewritten from the verified
 * token plus the registered MediaObject, never trusted from the client.
 * Missing tokens (retired resource-backed protocol) and foreign, unknown or
 * inconsistent media fail closed.
 */
export async function resolveProjectAssistantMediaAttachments(input: {
  readonly userId: string
  readonly projectId: string
  readonly refs: readonly Pick<ProjectAssistantMediaAttachment, 'resourceId' | 'attachmentToken'>[]
}): Promise<ProjectAssistantMediaAttachment[]> {
  if (input.refs.length === 0) return []
  return await Promise.all(input.refs.map(async (ref) => {
    if (!ref.attachmentToken) {
      throw new Error(`PROJECT_ASSISTANT_MEDIA_ATTACHMENT_TOKEN_REQUIRED:${ref.resourceId}`)
    }
    const registration = await resolveProjectAssistantAttachmentRegistration({
      userId: input.userId,
      projectId: input.projectId,
      attachmentToken: ref.attachmentToken,
    })
    if (ref.resourceId !== registration.payload.resourceId) {
      throw new Error(`PROJECT_ASSISTANT_MEDIA_ATTACHMENT_IDENTITY_MISMATCH:${ref.resourceId}`)
    }
    return {
      resourceId: registration.payload.resourceId,
      attachmentToken: ref.attachmentToken,
      mediaType: registration.payload.mediaType,
      name: registration.payload.name,
      href: null,
    }
  }))
}
