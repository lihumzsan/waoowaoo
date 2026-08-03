import { z } from 'zod'
import type { WorkspaceResourceInputRef } from '@/lib/workspace-resource/contracts'
import { workspaceResourceInputRefSchema } from '@/lib/workspace-resource/generation-contract'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  reserveWorkspaceResourceInTransaction,
  validateWorkspaceResourceInputReferencesInTransaction,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { refineTaskSubmitOperationOutputSchema, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'

const mergeVideosInputSchema = z.object({
  outputPath: z.string().trim().min(1).max(512)
    .regex(/\.resource$/u, 'Merged video outputPath must end in .resource.')
    .describe('Complete project-relative video pointer path ending in .resource.'),
  videos: z.array(workspaceResourceInputRefSchema).min(1).max(50),
  music: workspaceResourceInputRefSchema.optional(),
}).strict().refine((input) => input.videos.length >= 2 || Boolean(input.music), {
  message: 'A single video requires a music input.',
  path: ['videos'],
})

const mergeVideosOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
  }).passthrough(),
)

function normalizeMergeInputs(input: z.infer<typeof mergeVideosInputSchema>): WorkspaceResourceInputRef[] {
  const videos: WorkspaceResourceInputRef[] = input.videos.map((video, position) => ({
    ...video,
    role: 'source_video',
    position,
  }))
  return input.music ? [
    ...videos,
    { ...input.music, role: 'bgm_audio', position: videos.length },
  ] : videos
}

export function createWorkspaceResourceVideoMergeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    merge_videos: defineOperation({
      id: 'merge_videos',
      summary: 'Concatenate exact frozen video Resource versions and optionally mix one exact audio Resource version into a new video at an explicit workspace path.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
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
        contractRevision: 'merge_videos/v2',
        followUpPolicy: 'after_all_terminal',
      },
      inputSchema: mergeVideosInputSchema,
      outputSchema: mergeVideosOutputSchema,
      execute: async (ctx, input) => {
        const references = normalizeMergeInputs(input)
        const inputHash = stableArgsFingerprint({ outputPath: input.outputPath, references })
        const requestId = [
          'merge_videos', ctx.userId, ctx.projectId,
          ctx.context.turnId?.trim() || 'no-turn',
          ctx.toolCallId?.trim() || ctx.requestId?.trim() || inputHash,
        ].join(':')
        const resourceId = buildWorkspaceResourceId({ operationId: 'merge_videos', requestId, memberIndex: 0 })
        const generationOptions: Record<string, string | number> = input.music
          ? { mergeMode: 'ordered_concat', bgmVolume: 1 }
          : { mergeMode: 'ordered_concat' }
        const payload = {
          lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
            resourceId,
            mediaType: 'video',
            schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
            name: 'Merged video',
          }]),
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
            await validateWorkspaceResourceInputReferencesInTransaction(tx, {
              userId: ctx.userId,
              projectId: ctx.projectId,
            }, references)
            await reserveWorkspaceResourceInTransaction(tx, {
              resourceId,
              userId: ctx.userId,
              projectId: ctx.projectId,
              outputPath: input.outputPath,
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
        return mergeVideosOutputSchema.parse({ ...result, resourceId, workspacePath: input.outputPath })
      },
    }),
  }
}
