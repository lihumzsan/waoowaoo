import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import sharp from 'sharp'
import { ApiError } from '@/lib/api-errors'
import { resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import {
  materializeCreativeResourceInTransaction,
  reserveDomainCreativeResourceInTransaction,
} from '@/lib/creative-resource/persistence'
import {
  buildUserUploadProvenance,
  buildUserUploadSourceId,
  buildUserUploadStorageKey,
  resolveUserUploadAcceptedMedia,
  USER_UPLOAD_SOURCE_TYPE,
  userUploadSchemaIdForMediaType,
} from '@/lib/creative-resource/upload-contract'
import {
  assertFileSizeWithinLimit,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_MULTIPART_MEDIA_UPLOAD_REQUEST_BYTES,
  readFormDataWithLimit,
} from '@/lib/http/body-limits'
import { detectMimeFromBuffer } from '@/lib/media/outbound-image'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { deleteObject, uploadObject } from '@/lib/storage'
import { createWorkspaceResourceBroadcastsInTransaction } from '@/lib/workspace-resource/resource-change-events'

type UploadFileLike = {
  name: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

function isFileLike(value: unknown): value is UploadFileLike {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<UploadFileLike>
  return typeof file.name === 'string' && typeof file.size === 'number'
    && typeof file.arrayBuffer === 'function'
}

const preparedUserUploadSchema = z.object({
  mediaType: z.enum(['image', 'audio']),
  schemaId: z.string().min(1),
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  fileName: z.string().min(1).max(500),
  name: z.string().min(1).max(200),
}).strict()

type PreparedUserUpload = z.infer<typeof preparedUserUploadSchema>

const uploadMediaOutputSchema = z.object({
  success: z.literal(true),
  resource: z.object({
    resourceId: z.string().min(1),
  }).strict(),
  mediaType: z.enum(['image', 'audio']),
  schemaId: z.string().min(1),
  name: z.string().min(1),
  href: z.string().startsWith('/m/'),
  reused: z.boolean(),
}).strict()

function normalizeUploadName(rawName: unknown, fileName: string, mediaType: 'image' | 'audio'): string {
  const explicit = typeof rawName === 'string' ? rawName.trim() : ''
  if (explicit) return explicit.slice(0, 200)
  const fromFile = fileName.replace(/\.[a-zA-Z0-9]{1,12}$/, '').trim()
  if (fromFile) return fromFile.slice(0, 200)
  return mediaType === 'image' ? 'Uploaded image' : 'Uploaded audio'
}

async function normalizeUploadImage(
  buffer: Buffer,
  mimeType: string,
): Promise<{ readonly stored: Buffer; readonly width: number | null; readonly height: number | null }> {
  // Re-encoding through sharp both sanitizes hostile payloads and strips
  // metadata; auto-rotation bakes EXIF orientation into the pixels so every
  // downstream consumer sees the image the way the user saw it.
  const pipeline = sharp(buffer).rotate()
  const stored = mimeType === 'image/png'
    ? await pipeline.png().toBuffer()
    : mimeType === 'image/webp'
      ? await pipeline.webp({ quality: 90 }).toBuffer()
      : await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  const metadata = await sharp(stored).metadata()
  return {
    stored,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
  }
}

async function prepareUserMediaUpload(request: Request): Promise<PreparedUserUpload> {
  const formData = await readFormDataWithLimit(
    request,
    MAX_MULTIPART_MEDIA_UPLOAD_REQUEST_BYTES,
    'project media upload',
  )
  const file = formData.get('file')
  if (!isFileLike(file)) {
    throw new ApiError('INVALID_PARAMS', { code: 'UPLOAD_FILE_REQUIRED', field: 'file' })
  }
  assertFileSizeWithinLimit(file, MAX_AUDIO_BYTES, 'project media upload')

  const buffer = Buffer.from(await file.arrayBuffer())
  const accepted = resolveUserUploadAcceptedMedia(detectMimeFromBuffer(buffer))
  if (!accepted) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'UPLOAD_MEDIA_TYPE_UNSUPPORTED',
      field: 'file',
      message: 'only PNG, JPEG, WebP images and MP3, WAV, OGG audio uploads are supported',
    })
  }
  const maxBytes = accepted.mediaType === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES
  if (buffer.byteLength > maxBytes) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PAYLOAD_TOO_LARGE',
      field: 'file',
      message: `project media upload exceeds the ${maxBytes} byte limit`,
    })
  }

  const normalized = accepted.mediaType === 'image'
    ? await normalizeUploadImage(buffer, accepted.mimeType)
    : { stored: buffer, width: null, height: null }
  if (normalized.stored.byteLength > maxBytes) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PAYLOAD_TOO_LARGE',
      field: 'file',
      message: `project media upload exceeds the ${maxBytes} byte limit`,
    })
  }

  const sha256 = createHash('sha256').update(normalized.stored).digest('hex')
  const storageKey = buildUserUploadStorageKey({ sha256, extension: accepted.extension })
  const fileName = (file.name.trim() || 'upload').slice(0, 500)
  const prepared: PreparedUserUpload = {
    mediaType: accepted.mediaType,
    schemaId: userUploadSchemaIdForMediaType(accepted.mediaType),
    storageKey,
    mimeType: accepted.mimeType,
    sizeBytes: normalized.stored.byteLength,
    width: normalized.width,
    height: normalized.height,
    sha256,
    fileName,
    name: normalizeUploadName(formData.get('name'), fileName, accepted.mediaType),
  }
  // Content-addressed key: identical bytes overwrite an identical object, so
  // this upload never orphans a second copy and retries are idempotent.
  await uploadObject(normalized.stored, storageKey, undefined, accepted.mimeType)
  return prepared
}

export function createMediaUploadApiOperations(): ProjectAgentOperationRegistryDraft {
  return {
    api_project_upload_media: defineOperation({
      id: 'api_project_upload_media',
      summary: 'API-only: Materialize one user-uploaded image or audio file as a ready project upload Resource, consumable through the standard resource reference protocol.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'none',
        acceptsReferences: false,
        outputMediaTypes: ['image', 'audio'],
        outputSchemaIds: [
          userUploadSchemaIdForMediaType('image'),
          userUploadSchemaIdForMediaType('audio'),
        ],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: z.object({}).passthrough(),
      outputSchema: uploadMediaOutputSchema,
      prepareTransaction: async (ctx) => {
        return await prepareUserMediaUpload(ctx.request)
      },
      executeInTransaction: async (ctx, _input, transaction, preparedValue) => {
        const prepared = preparedUserUploadSchema.parse(preparedValue)
        const scope = resolveProjectCreativeResourceScope({
          userId: ctx.userId,
          projectId: ctx.projectId,
          episodeId: null,
        })
        const media = await ensureMediaObjectFromStorageKey(prepared.storageKey, {
          sha256: prepared.sha256,
          mimeType: prepared.mimeType,
          sizeBytes: prepared.sizeBytes,
          width: prepared.width,
          height: prepared.height,
        }, transaction)
        const reserved = await reserveDomainCreativeResourceInTransaction(transaction, {
          scope,
          mediaType: prepared.mediaType,
          schemaId: prepared.schemaId,
          sourceType: USER_UPLOAD_SOURCE_TYPE,
          sourceId: buildUserUploadSourceId({ projectId: ctx.projectId, sha256: prepared.sha256 }),
          name: prepared.name,
        })
        if (reserved.status === 'ready') {
          const existing = await transaction.creativeResource.findUnique({
            where: { id: reserved.resourceId },
            select: { materializedAt: true, name: true },
          })
          if (!existing?.materializedAt) {
            throw new Error(`USER_UPLOAD_READY_MATERIALIZATION_MISSING:${reserved.resourceId}`)
          }
          return uploadMediaOutputSchema.parse({
            success: true,
            resource: { resourceId: reserved.resourceId },
            mediaType: prepared.mediaType,
            schemaId: prepared.schemaId,
            name: existing.name ?? prepared.name,
            href: media.url,
            reused: true,
          })
        }
        const resource = await materializeCreativeResourceInTransaction(transaction, {
          resourceId: reserved.resourceId,
          userId: ctx.userId,
          mediaType: prepared.mediaType,
          schemaId: prepared.schemaId,
          content: { kind: 'media', mediaId: media.id },
          inputs: [],
          provenance: {
            operationId: 'api_project_upload_media',
            inputHash: prepared.sha256,
            taskId: null,
            operationExecutionId: null,
            executionSegmentId: null,
            toolCallId: null,
            prompt: null,
            modelKey: null,
            generationOptions: buildUserUploadProvenance({
              fileName: prepared.fileName,
              sha256: prepared.sha256,
              mimeType: prepared.mimeType,
              sizeBytes: prepared.sizeBytes,
            }),
          },
        })
        await createWorkspaceResourceBroadcastsInTransaction({
          tx: transaction,
          invocationId: `api_project_upload_media:${randomUUID()}`,
          affectedResources: [{ kind: 'creativeResources', projectId: ctx.projectId, episodeId: null }],
          userId: ctx.userId,
          operationId: 'api_project_upload_media',
        })
        return uploadMediaOutputSchema.parse({
          success: true,
          resource: resource,
          mediaType: prepared.mediaType,
          schemaId: prepared.schemaId,
          name: prepared.name,
          href: media.url,
          reused: false,
        })
      },
      compensateTransactionFailure: async (_ctx, _input, preparedValue) => {
        const prepared = preparedUserUploadSchema.parse(preparedValue)
        // The content-addressed key may be shared with an earlier upload of the
        // same bytes (including another user's), so the object is only removed
        // when no committed MediaObject row claims it; a registered object is
        // owned by the media lifecycle, never by this failed invocation.
        const committed = await prisma.mediaObject.findUnique({
          where: { storageKey: prepared.storageKey },
          select: { id: true },
        })
        if (committed) return
        await deleteObject(prepared.storageKey)
      },
    }),
  }
}
