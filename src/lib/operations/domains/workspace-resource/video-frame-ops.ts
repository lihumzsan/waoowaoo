import { z } from 'zod'
import type { WorkspaceResourceInputRef } from '@/lib/workspace-resource/contracts'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  createWorkspaceResourceFolderInTransaction,
  reserveWorkspaceResourceInTransaction,
  resolveGeneratedWorkspaceResourcePlacement,
  resolveWorkspaceResourceInputs,
  validateWorkspaceResourceInputReferencesInTransaction,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { workspaceResourceDisplayName } from '@/lib/workspace-resource/path'
import { videoFrameSelectorSchema } from '@/lib/workspace-resource/video-frame-contract'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'

const extractVideoFrameInputSchema = z.object({
  folderPath: z.string().trim().min(1).max(512).nullable().optional()
    .describe('Optional project-relative destination folder. Missing folders are created atomically with the extracted image Resource.'),
  name: z.string().trim().min(1).max(300),
  video: z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  }).strict(),
  selector: videoFrameSelectorSchema.describe(
    'Required frame selection from the first video stream. first_decodable selects the first successfully decoded frame; last_decodable selects the final successfully decoded frame. Neither selector avoids black or fade frames.',
  ),
}).strict()

const extractVideoFrameOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
  }).passthrough(),
)

export function createWorkspaceResourceVideoFrameOperations(): ProjectAgentOperationRegistryDraft {
  return {
    extract_video_frame: defineOperation({
      id: 'extract_video_frame',
      summary: 'Derive the explicitly selected frame of one exact ready video Resource version into a reusable ready image Resource.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputResourceKinds: ['file'],
        outputMediaTypes: ['image'],
        outputSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE],
        placement: 'required',
      },
      confirmation: { kind: 'none', required: false },
      assistantWriteAuthority: {
        kind: 'temporal_operation_execution',
        contractRevision: 'extract_video_frame/v2',
        followUpPolicy: 'after_all_terminal',
      },
      inputSchema: extractVideoFrameInputSchema,
      outputSchema: extractVideoFrameOutputSchema,
      execute: async (ctx, input) => {
        const references: readonly WorkspaceResourceInputRef[] = await resolveWorkspaceResourceInputs(prisma, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          references: [{
            resourceId: input.video.resourceId,
            contentVersion: input.video.contentVersion,
            role: 'source_video',
            position: 0,
            expectedMediaType: 'video',
          }],
        })
        const generationOptions = {
          selector: input.selector,
          outputFormat: 'png' as const,
        }
        const inputHash = stableArgsFingerprint({ references, generationOptions })
        const requestId = [
          'extract_video_frame',
          ctx.userId,
          ctx.projectId,
          ctx.context.turnId?.trim() || 'no-turn',
          ctx.toolCallId?.trim() || ctx.requestId?.trim() || inputHash,
        ].join(':')
        const resourceId = buildWorkspaceResourceId({
          operationId: 'extract_video_frame',
          requestId,
          memberIndex: 0,
        })
        const outputPath = await resolveGeneratedWorkspaceResourcePlacement(prisma, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          folderPath: input.folderPath,
          name: input.name,
          resourceId,
          mediaType: 'image',
          schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
        })
        const payload = {
          lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
            resourceId,
            mediaType: 'image',
            schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
            name: workspaceResourceDisplayName({ workspacePath: outputPath, resourceId }),
          }]),
          protocol: 'workspace_resource_video_frame_v1' as const,
          resource: {
            resourceId,
            mediaType: 'image' as const,
            schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
            prompt: null,
            modelKey: null,
            inputHash,
            inputs: references,
            generationOptions,
            toolCallId: ctx.toolCallId?.trim() || null,
          },
        }
        const result = await submitOperationTask({
          request: ctx.request,
          requestId: ctx.requestId,
          userId: ctx.userId,
          projectId: ctx.projectId,
          type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_FRAME,
          targetType: 'WorkspaceResource',
          targetId: resourceId,
          operationId: 'extract_video_frame',
          source: ctx.source,
          operationExecutionId: ctx.operationExecutionId,
          operationExecutionTransaction: ctx.operationExecutionTransaction,
          followUpBatchBinding: ctx.followUpBatchBinding,
          payload,
          decoratePayload: false,
          dedupeKey: `extract_video_frame:${resourceId}:${inputHash}`,
          locale: resolveOperationLocale(ctx.context),
          onTaskCreatedInTransaction: async (tx, task) => {
            if (input.folderPath) {
              await createWorkspaceResourceFolderInTransaction(tx, {
                userId: ctx.userId,
                projectId: ctx.projectId,
                workspacePath: input.folderPath,
                sourceType: 'operation_output_folder',
                sourceId: null,
              })
            }
            await validateWorkspaceResourceInputReferencesInTransaction(tx, {
              userId: ctx.userId,
              projectId: ctx.projectId,
            }, references)
            await reserveWorkspaceResourceInTransaction(tx, {
              resourceId,
              userId: ctx.userId,
              projectId: ctx.projectId,
              outputPath,
              mediaType: 'image',
              schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
              operationId: 'extract_video_frame',
              inputHash,
              taskId: task.id,
              operationExecutionId: ctx.operationExecutionId ?? null,
              toolCallId: ctx.toolCallId?.trim() || null,
              generationOptions,
            })
          },
        })
        return extractVideoFrameOutputSchema.parse({
          ...result,
          resourceId,
          workspacePath: outputPath,
        })
      },
    }),
  }
}
