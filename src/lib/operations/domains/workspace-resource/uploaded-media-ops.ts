import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  createWorkspaceResourceFolderInTransaction,
  materializeWorkspaceResourceInTransaction,
  reserveWorkspaceResourceInTransaction,
  resolveGeneratedWorkspaceResourcePlacement,
} from '@/lib/workspace-resource/persistence'
import {
  buildUserUploadProvenance,
  buildUserUploadResourceId,
  buildUserUploadSourceId,
  USER_UPLOAD_SOURCE_TYPE,
  userUploadSchemaIdForMediaType,
} from '@/lib/workspace-resource/upload-contract'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { PROJECT_ASSISTANT_ATTACHMENT_TOKEN_MAX_CHARS, ProjectAssistantAttachmentTokenError } from '@/lib/project-agent/media-attachments/attachment-token'
import { resolveProjectAssistantAttachmentRegistration } from '@/lib/project-agent/media-attachments/resolve'

const registerUploadedMediaInputSchema = z.object({
  attachmentToken: z.string().min(1).max(PROJECT_ASSISTANT_ATTACHMENT_TOKEN_MAX_CHARS),
  folderPath: z.string().trim().min(1).max(512).nullable().optional()
    .describe('Optional project-relative destination folder. Missing folders are created atomically with the uploaded Resource.'),
  name: z.string().trim().min(1).max(200).optional(),
}).strict()

const registerUploadedMediaOutputSchema = z.object({
  success: z.literal(true),
  resources: z.array(z.object({ resourceId: z.string().min(1), workspacePath: z.string().min(1) }).strict()).length(1),
  mediaType: z.enum(['image', 'audio']),
  schemaId: z.string().min(1),
  reused: z.boolean(),
}).strict()

function mapAttachmentResolutionError(error: unknown): never {
  if (error instanceof ProjectAssistantAttachmentTokenError && error.code !== 'ATTACHMENT_TOKEN_SECRET_UNAVAILABLE') {
    throw new ApiError('INVALID_PARAMS', {
      code: `UPLOADED_MEDIA_${error.code}`,
      field: 'attachmentToken',
      agentRetryableAfterCorrection: error.code !== 'ATTACHMENT_TOKEN_SCOPE_MISMATCH',
    })
  }
  throw error
}

export function createWorkspaceResourceUploadedMediaOperations(): ProjectAgentOperationRegistryDraft {
  return {
    register_uploaded_media: defineOperation({
      id: 'register_uploaded_media',
      summary: 'Materialize one verified chat-uploaded image/audio as a ready Resource with server-owned placement.',
      intent: 'act',
      toolContractRevision: 'register_uploaded_media/v6',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'workspace_resources',
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
        outputResourceKinds: ['file'],
        outputMediaTypes: ['image', 'audio'],
        outputSchemaIds: [userUploadSchemaIdForMediaType('image'), userUploadSchemaIdForMediaType('audio')],
        placement: 'required',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: registerUploadedMediaInputSchema,
      outputSchema: registerUploadedMediaOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        let registration
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
        const resourceId = buildUserUploadResourceId({ projectId: ctx.projectId, sha256: payload.sha256 })
        if (payload.resourceId !== resourceId) throw new Error('UPLOADED_MEDIA_ATTACHMENT_IDENTITY_MISMATCH')
        const schemaId = userUploadSchemaIdForMediaType(payload.mediaType)
        const existing = await tx.workspaceResource.findUnique({ where: { id: resourceId } })
        if (existing?.status === 'ready') {
          if (existing.deletedAt) {
            throw new ApiError('CONFLICT', {
              code: 'UPLOADED_MEDIA_EXISTING_PLACEMENT_CONFLICT',
              field: 'attachmentToken',
              existingWorkspacePath: existing.workspacePath,
            })
          }
          return registerUploadedMediaOutputSchema.parse({
            success: true,
            resources: [{ resourceId, workspacePath: existing.workspacePath }],
            mediaType: payload.mediaType,
            schemaId,
            reused: true,
          })
        }
        if (input.folderPath) {
          await createWorkspaceResourceFolderInTransaction(tx, {
            userId: ctx.userId,
            projectId: ctx.projectId,
            workspacePath: input.folderPath,
            sourceType: 'operation_output_folder',
            sourceId: null,
          })
        }
        const outputPath = await resolveGeneratedWorkspaceResourcePlacement(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          folderPath: input.folderPath,
          name: input.name || payload.fileName,
          resourceId,
          mediaType: payload.mediaType,
          schemaId,
        })
        await reserveWorkspaceResourceInTransaction(tx, {
          resourceId,
          userId: ctx.userId,
          projectId: ctx.projectId,
          outputPath,
          mediaType: payload.mediaType,
          schemaId,
          sourceType: USER_UPLOAD_SOURCE_TYPE,
          sourceId: buildUserUploadSourceId({ projectId: ctx.projectId, sha256: payload.sha256 }),
          operationId: 'register_uploaded_media',
          inputHash: payload.sha256,
          toolCallId: ctx.toolCallId?.trim() || ctx.requestId?.trim() || null,
        })
        const mimeType = registration.media.mimeType
        const sizeBytes = registration.media.sizeBytes
        if (!mimeType || sizeBytes === null) throw new Error('USER_UPLOAD_MEDIA_FACTS_MISSING')
        await materializeWorkspaceResourceInTransaction(tx, {
          resourceId,
          userId: ctx.userId,
          projectId: ctx.projectId,
          mediaType: payload.mediaType,
          schemaId,
          content: { kind: 'media', mediaId: registration.media.id },
          inputs: [],
          provenance: {
            operationId: 'register_uploaded_media',
            inputHash: payload.sha256,
            taskId: null,
            operationExecutionId: ctx.operationExecutionId ?? null,
            toolCallId: ctx.toolCallId?.trim() || ctx.requestId?.trim() || null,
            prompt: null,
            modelKey: null,
            generationOptions: buildUserUploadProvenance({
              fileName: payload.fileName,
              sha256: payload.sha256,
              mimeType,
              sizeBytes,
            }),
          },
        })
        return registerUploadedMediaOutputSchema.parse({
          success: true,
          resources: [{ resourceId, workspacePath: outputPath }],
          mediaType: payload.mediaType,
          schemaId,
          reused: false,
        })
      },
    }),
  }
}
