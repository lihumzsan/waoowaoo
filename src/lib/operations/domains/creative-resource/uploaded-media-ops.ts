import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import {
  materializeCreativeResourceInTransaction,
  reserveDomainCreativeResourceInTransaction,
} from '@/lib/creative-resource/persistence'
import {
  buildUserUploadProvenance,
  buildUserUploadResourceId,
  buildUserUploadSourceId,
  USER_UPLOAD_SOURCE_TYPE,
  userUploadSchemaIdForMediaType,
} from '@/lib/creative-resource/upload-contract'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { PROJECT_ASSISTANT_ATTACHMENT_TOKEN_MAX_CHARS, ProjectAssistantAttachmentTokenError } from '@/lib/project-agent/media-attachments/attachment-token'
import {
  resolveProjectAssistantAttachmentRegistration,
  type ResolvedProjectAssistantAttachmentRegistration,
} from '@/lib/project-agent/media-attachments/resolve'

const registerUploadedMediaInputSchema = z.object({
  attachmentToken: z.string().min(1).max(PROJECT_ASSISTANT_ATTACHMENT_TOKEN_MAX_CHARS)
    .describe('Exact attachmentToken copied verbatim from one <uploaded_media> tag in this conversation. Never invent, edit, or truncate it.'),
  name: z.string().max(200)
    .describe('Display name for the materialized Resource in the conversation language. Empty string keeps the name registered at upload time.'),
}).strict()

const registerUploadedMediaOutputSchema = z.object({
  success: z.literal(true),
  resources: z.array(z.object({
    resourceId: z.string().min(1),
  }).strict()).length(1),
  mediaType: z.enum(['image', 'audio']),
  schemaId: z.string().min(1),
  name: z.string().min(1),
  reused: z.boolean(),
}).strict()

function mapAttachmentResolutionError(error: unknown): never {
  if (
    error instanceof ProjectAssistantAttachmentTokenError
    && error.code !== 'ATTACHMENT_TOKEN_SECRET_UNAVAILABLE'
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: `UPLOADED_MEDIA_${error.code}`,
      field: 'attachmentToken',
      // A malformed token is usually a copy error the model can correct by
      // re-reading the exact <uploaded_media> tag; a foreign scope never is.
      agentRetryableAfterCorrection: error.code !== 'ATTACHMENT_TOKEN_SCOPE_MISMATCH',
      message: 'attachmentToken must be copied verbatim from an <uploaded_media> tag of this conversation',
    })
  }
  if (error instanceof Error && error.message.startsWith('PROJECT_ASSISTANT_MEDIA_ATTACHMENT_')) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'UPLOADED_MEDIA_ATTACHMENT_UNAVAILABLE',
      field: 'attachmentToken',
      agentRetryableAfterCorrection: false,
      message: 'the registered upload behind this attachment is no longer available; ask the user to re-upload the file',
    })
  }
  throw error
}

export function createCreativeResourceUploadedMediaOperations(): ProjectAgentOperationRegistryDraft {
  return {
    register_uploaded_media: defineOperation({
      id: 'register_uploaded_media',
      summary: 'Materialize one chat-uploaded attachment (image or audio) as a ready project upload Resource, using the exact attachmentToken from its <uploaded_media> tag. Call this before passing user-uploaded material into generation references, lineage, or transcription; afterwards only the returned resourceId identifies the material. The same uploaded content converges to the same Resource, so repeated calls are safe and return reused=true.',
      intent: 'act',
      toolContractRevision: 'register_uploaded_media/v1',
      channels: { tool: true, api: false },
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: false,
        outputMediaTypes: ['image', 'audio'],
        outputSchemaIds: [
          userUploadSchemaIdForMediaType('image'),
          userUploadSchemaIdForMediaType('audio'),
        ],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: registerUploadedMediaInputSchema,
      outputSchema: registerUploadedMediaOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        let registration: ResolvedProjectAssistantAttachmentRegistration
        try {
          registration = await resolveProjectAssistantAttachmentRegistration({
            userId: ctx.userId,
            projectId: ctx.projectId,
            attachmentToken: input.attachmentToken,
            client: tx,
          })
        } catch (error) {
          mapAttachmentResolutionError(error)
        }
        const payload = registration.payload
        const expectedResourceId = buildUserUploadResourceId({
          projectId: ctx.projectId,
          sha256: payload.sha256,
        })
        if (payload.resourceId !== expectedResourceId) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'UPLOADED_MEDIA_ATTACHMENT_IDENTITY_MISMATCH',
            field: 'attachmentToken',
            agentRetryableAfterCorrection: false,
          })
        }
        const schemaId = userUploadSchemaIdForMediaType(payload.mediaType)
        const name = input.name.trim() || payload.name
        // Uploads are project-scoped facts: the same content re-attached from
        // any episode context converges to one project-level Resource.
        const scope = resolveProjectCreativeResourceScope({
          userId: ctx.userId,
          projectId: ctx.projectId,
          episodeId: null,
        })
        const reserved = await reserveDomainCreativeResourceInTransaction(tx, {
          scope,
          mediaType: payload.mediaType,
          schemaId,
          sourceType: USER_UPLOAD_SOURCE_TYPE,
          sourceId: buildUserUploadSourceId({ projectId: ctx.projectId, sha256: payload.sha256 }),
          name,
        })
        const mediaMimeType = registration.media.mimeType
        const mediaSizeBytes = registration.media.sizeBytes
        if (mediaMimeType === null || mediaSizeBytes === null) {
          // Registration always records both facts; a row missing them cannot
          // produce truthful provenance and must fail instead of guessing.
          throw new Error(`USER_UPLOAD_MEDIA_FACTS_MISSING:${registration.media.publicId}`)
        }
        if (reserved.status === 'ready') {
          const existing = await tx.creativeResource.findUnique({
            where: { id: reserved.resourceId },
            select: { materializedAt: true, name: true },
          })
          if (!existing?.materializedAt) {
            throw new Error(`USER_UPLOAD_READY_MATERIALIZATION_MISSING:${reserved.resourceId}`)
          }
          return registerUploadedMediaOutputSchema.parse({
            success: true,
            resources: [{ resourceId: reserved.resourceId }],
            mediaType: payload.mediaType,
            schemaId,
            name: existing.name ?? name,
            reused: true,
          })
        }
        const resource = await materializeCreativeResourceInTransaction(tx, {
          resourceId: reserved.resourceId,
          userId: ctx.userId,
          mediaType: payload.mediaType,
          schemaId,
          content: { kind: 'media', mediaId: registration.media.id },
          inputs: [],
          provenance: {
            operationId: 'register_uploaded_media',
            inputHash: payload.sha256,
            taskId: null,
            operationExecutionId: null,
            toolCallId: ctx.toolCallId?.trim() || null,
            prompt: null,
            modelKey: null,
            generationOptions: buildUserUploadProvenance({
              fileName: payload.fileName,
              sha256: payload.sha256,
              mimeType: mediaMimeType,
              sizeBytes: mediaSizeBytes,
            }),
          },
        })
        return registerUploadedMediaOutputSchema.parse({
          success: true,
          resources: [{ resourceId: resource.resourceId }],
          mediaType: payload.mediaType,
          schemaId,
          name,
          reused: false,
        })
      },
    }),
  }
}
