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
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'
import {
  videoCompositionSchema,
  compositionTargetSchema,
} from '@/lib/video-compose/composition-contract'
import {
  COMPOSITION_TARGETS,
  validateCompositionTarget,
} from '@/lib/video-compose/composition-target-registry'
import { resolveCompositionTiming } from '@/lib/video-compose/composition-timing'
import { readProjectVideoCanvas } from '@/lib/operations/project-video-ratio-policy'
import { freezeCompositionSources } from '@/lib/video-compose/freeze-composition'
import { freezeJianyingProfile } from '@/lib/jianying/profile'
import { workspaceResourceVideoMergeTaskPayloadSchema } from '@/lib/workspace-resource/video-merge-contract'
import { resolveFrozenVideoMergeAudioCues } from '@/lib/workspace-resource/video-merge-cues'

const mergeVideosInputSchema = z
  .object({
    folderPath: z.string().trim().min(1).max(512).nullable().optional(),
    name: z.string().trim().min(1).max(300),
    composition: videoCompositionSchema,
    outputTarget: compositionTargetSchema,
  })
  .strict()

const mergeVideosOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase
    .extend({
      resourceId: z.string().min(1),
      workspacePath: z.string().min(1),
    })
    .passthrough(),
)

export function createWorkspaceResourceVideoMergeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    merge_videos: defineOperation({
      id: 'merge_videos',
      summary:
        'Compose exact video versions using explicit clip instances and source trims. Export MP4, or an editable Jianying project ZIP with character names and native text fades. MP4 does not support text layers.',
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
        outputMediaTypes: ['video', 'archive'],
        outputSchemaIds: [
          WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
          WORKSPACE_RESOURCE_SCHEMA.JIANYING_PROJECT,
        ],
        placement: 'required',
      },
      confirmation: { kind: 'none', required: false },
      assistantWriteAuthority: {
        kind: 'temporal_operation_execution',
        contractRevision: 'merge_videos/v9',
        followUpPolicy: 'after_all_terminal',
      },
      inputSchema: mergeVideosInputSchema,
      outputSchema: mergeVideosOutputSchema,
      execute: async (ctx, input) => {
        const { composition, outputTarget } = input
        validateCompositionTarget(outputTarget, composition)
        const target = COMPOSITION_TARGETS[outputTarget]
        const jianyingProfile =
          outputTarget === 'jianying_project'
            ? await freezeJianyingProfile()
            : null
        const audio = composition.audio
        const videos = composition.clips.map((clip) => clip.source)
        const audioReferences = [
          ...(audio.backgroundMusic
            ? [
                {
                  ...audio.backgroundMusic,
                  role: 'background_music',
                  allowedSchemaIds: [
                    WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
                    WORKSPACE_RESOURCE_SCHEMA.UPLOAD_AUDIO,
                  ],
                },
              ]
            : []),
          ...(audio.replacementAudio
            ? [{ ...audio.replacementAudio, role: 'replacement_audio' }]
            : []),
          ...audio.musicCues.map((cue) => ({
            resourceId: cue.resourceId,
            contentVersion: cue.contentVersion,
            role: 'bgm_audio',
            allowedSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO],
          })),
          ...audio.soundCues.map((cue) => ({
            resourceId: cue.resourceId,
            contentVersion: cue.contentVersion,
            role: 'sound_effect_audio',
            allowedSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.SOUND_EFFECT_AUDIO],
          })),
        ]
        const characters = composition.textLayers.flatMap((layer) =>
          layer.nameSource.kind === 'character_resource'
            ? [layer.nameSource.reference]
            : [],
        )
        const references: readonly WorkspaceResourceInputRef[] =
          await resolveWorkspaceResourceInputs(prisma, {
            userId: ctx.userId,
            projectId: ctx.projectId,
            references: [
              ...videos.map((video, position) => ({
                ...video,
                role: 'source_video',
                position,
                expectedMediaType: 'video' as const,
              })),
              ...audioReferences.map((ref, index) => ({
                ...ref,
                position: videos.length + index,
                expectedMediaType: 'audio' as const,
              })),
              ...characters.map((ref, index) => ({
                ...ref,
                role: 'character_context',
                position: videos.length + audioReferences.length + index,
                expectedMediaType: 'image' as const,
                allowedSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE],
              })),
              ...composition.contextReferences.map((ref, index) => ({
                ...ref,
                role: 'editing_context',
                position:
                  videos.length +
                  audioReferences.length +
                  characters.length +
                  index,
                allowedSchemaIds: [
                  WORKSPACE_RESOURCE_SCHEMA.SCREENPLAY,
                  WORKSPACE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
                  WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT,
                  WORKSPACE_RESOURCE_SCHEMA.VIDEO_EDIT,
                ],
              })),
            ],
          })
        const sourceFacts = await freezeCompositionSources({
          userId: ctx.userId,
          projectId: ctx.projectId,
          references,
          composition,
          maxInputBytes: target.maxInputBytes,
        })
        const { musicCues, soundCues } = await resolveFrozenVideoMergeAudioCues(
          {
            userId: ctx.userId,
            projectId: ctx.projectId,
            references,
            musicCues: audio.musicCues,
            soundCues: audio.soundCues,
          },
        )
        const canvas = await readProjectVideoCanvas({
          userId: ctx.userId,
          projectId: ctx.projectId,
        })
        const firstSource = sourceFacts[0]
        if (!firstSource) throw new Error('COMPOSITION_SOURCE_FACTS_MISSING')
        resolveCompositionTiming(composition,firstSource.frameRate)
        const generationOptions = {
          format: { ...canvas, frameRate: firstSource.frameRate },
          name: input.name,
          locale: resolveOperationLocale(ctx.context),
          composition,
          outputTarget,
          sourceFacts,
          jianyingProfile,
        }
        const inputHash = stableArgsFingerprint({
          references,
          generationOptions,
          musicCues,
          soundCues,
        })
        const requestId = [
          'merge_videos',
          ctx.userId,
          ctx.projectId,
          ctx.context.turnId?.trim() || 'no-turn',
          ctx.toolCallId?.trim() || ctx.requestId?.trim() || inputHash,
        ].join(':')
        const resourceId = buildWorkspaceResourceId({
          operationId: 'merge_videos',
          requestId,
          memberIndex: 0,
        })
        const outputPath = await resolveGeneratedWorkspaceResourcePlacement(
          prisma,
          {
            userId: ctx.userId,
            projectId: ctx.projectId,
            folderPath: input.folderPath,
            name: input.name,
            resourceId,
            mediaType: target.mediaType,
            schemaId: target.schemaId,
          },
        )
        const payload = workspaceResourceVideoMergeTaskPayloadSchema.parse({
          lifecycleProjection: buildWorkspaceResourceLifecycleProjection([
            {
              resourceId,
              mediaType: target.mediaType,
              schemaId: target.schemaId,
              name: workspaceResourceDisplayName({
                workspacePath: outputPath,
                resourceId,
              }),
            },
          ]),
          protocol: 'workspace_resource_video_merge_v3',
          resource: {
            resourceId,
            mediaType: target.mediaType,
            schemaId: target.schemaId,
            prompt: null,
            modelKey: null,
            inputHash,
            inputs: references,
            generationOptions,
            musicCues,
            soundCues,
            toolCallId: ctx.toolCallId?.trim() || null,
          },
        })
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
            await validateWorkspaceResourceInputReferencesInTransaction(
              tx,
              {
                userId: ctx.userId,
                projectId: ctx.projectId,
              },
              references,
            )
            await reserveWorkspaceResourceInTransaction(tx, {
              resourceId,
              userId: ctx.userId,
              projectId: ctx.projectId,
              outputPath,
              mediaType: target.mediaType,
              schemaId: target.schemaId,
              operationId: 'merge_videos',
              inputHash,
              taskId: task.id,
              operationExecutionId: ctx.operationExecutionId ?? null,
              toolCallId: ctx.toolCallId?.trim() || null,
              generationOptions,
            })
          },
        })
        return mergeVideosOutputSchema.parse({
          ...result,
          resourceId,
          workspacePath: outputPath,
        })
      },
    }),
  }
}
