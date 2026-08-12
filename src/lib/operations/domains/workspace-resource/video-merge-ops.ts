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
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { refineTaskSubmitOperationOutputSchema, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'
import {
  videoMergeAudioModeSchema,
  type VideoMergeAudioMode,
} from '@/lib/workspace-resource/video-merge-contract'

export function buildVideoMergeInputHash(
  references: readonly WorkspaceResourceInputRef[],
  audioMode: VideoMergeAudioMode,
): string {
  return stableArgsFingerprint({ references, audioMode })
}

const mergeVideosInputSchema = z.object({
  folderPath: z.string().trim().min(1).max(512).nullable().optional()
    .describe('Optional project-relative destination folder. Missing folders are created atomically with the merged video Resource.'),
  name: z.string().trim().min(1).max(300),
  videos: z.array(z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  }).strict()).min(1).max(50),
  audioMode: videoMergeAudioModeSchema.describe(
    'Required final-audio behavior: preserve keeps source audio; mix keeps source audio and mixes the selected audio; replace removes source audio and uses only the selected audio; mute outputs no audio track.',
  ),
  backgroundMusic: z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  }).strict().optional().describe('Exact BGM or uploaded-audio Resource version required only by mix. It is treated as background music with fades and ducking.'),
  replacementAudio: z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  }).strict().optional().describe('Exact audio Resource version required only by replace. It becomes the complete final soundtrack.'),
}).strict().superRefine((input, context) => {
  if (input.audioMode === 'preserve' && input.videos.length < 2) {
    context.addIssue({ code: 'custom', path: ['videos'], message: 'Preserve mode requires at least two videos.' })
  }
  const validAudioInputs = input.audioMode === 'mix'
    ? Boolean(input.backgroundMusic) && !input.replacementAudio
    : input.audioMode === 'replace'
      ? Boolean(input.replacementAudio) && !input.backgroundMusic
      : !input.backgroundMusic && !input.replacementAudio
  if (!validAudioInputs) {
    context.addIssue({ code: 'custom', path: ['audioMode'], message: `${input.audioMode} mode audio input does not match its declared semantics.` })
  }
})

const mergeVideosOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
  }).passthrough(),
)

export function createWorkspaceResourceVideoMergeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    merge_videos: defineOperation({
      id: 'merge_videos',
      summary: 'Concatenate exact frozen video Resource versions and explicitly preserve, mix, replace, or remove the final audio track.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        destructive: false,
        overwrite: false,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputResourceKinds: ['file'],
        outputMediaTypes: ['video'],
        outputSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO],
        placement: 'required',
      },
      confirmation: { kind: 'none', required: false },
      assistantWriteAuthority: {
        kind: 'temporal_operation_execution',
        contractRevision: 'merge_videos/v6',
        followUpPolicy: 'after_all_terminal',
      },
      inputSchema: mergeVideosInputSchema,
      outputSchema: mergeVideosOutputSchema,
      execute: async (ctx, input) => {
        const references: readonly WorkspaceResourceInputRef[] = await resolveWorkspaceResourceInputs(prisma, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          references: [
            ...input.videos.map((video, position) => ({
              ...video,
              role: 'source_video',
              position,
              expectedMediaType: 'video' as const,
            })),
            ...(input.backgroundMusic ? [{
              ...input.backgroundMusic,
              role: 'background_music',
              position: input.videos.length,
              expectedMediaType: 'audio' as const,
              allowedSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO, WORKSPACE_RESOURCE_SCHEMA.UPLOAD_AUDIO],
            }] : []),
            ...(input.replacementAudio ? [{
              ...input.replacementAudio,
              role: 'replacement_audio',
              position: input.videos.length,
              expectedMediaType: 'audio' as const,
            }] : []),
          ],
        })
        const inputHash = buildVideoMergeInputHash(references, input.audioMode)
        const requestId = [
          'merge_videos', ctx.userId, ctx.projectId,
          ctx.context.turnId?.trim() || 'no-turn',
          ctx.toolCallId?.trim() || ctx.requestId?.trim() || inputHash,
        ].join(':')
        const resourceId = buildWorkspaceResourceId({ operationId: 'merge_videos', requestId, memberIndex: 0 })
        const outputPath = await resolveGeneratedWorkspaceResourcePlacement(prisma, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          folderPath: input.folderPath,
          name: input.name,
          resourceId,
          mediaType: 'video',
          schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        })
        const generationOptions: Record<string, string | number> = {
          mergeMode: 'ordered_concat',
          audioMode: input.audioMode,
        }
        const payload = {
          lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
            resourceId,
            mediaType: 'video',
            schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
            name: workspaceResourceDisplayName({ workspacePath: outputPath, resourceId }),
          }]),
          protocol: 'workspace_resource_video_merge_v1' as const,
          resource: {
            resourceId,
            mediaType: 'video' as const,
            schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
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
          type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
          targetType: 'WorkspaceResource',
          targetId: resourceId,
          operationId: 'merge_videos',
          source: ctx.source,
          operationExecutionId: ctx.operationExecutionId,
          operationExecutionTransaction: ctx.operationExecutionTransaction,
          followUpBatchBinding: ctx.followUpBatchBinding,
          payload,
          decoratePayload: false,
          dedupeKey: `merge_videos:${resourceId}:${inputHash}`,
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
              mediaType: 'video',
              schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
              operationId: 'merge_videos',
              inputHash,
              taskId: task.id,
              operationExecutionId: ctx.operationExecutionId ?? null,
              toolCallId: ctx.toolCallId?.trim() || null,
              generationOptions,
            })
          },
        })
        return mergeVideosOutputSchema.parse({ ...result, resourceId, workspacePath: outputPath })
      },
    }),
  }
}
