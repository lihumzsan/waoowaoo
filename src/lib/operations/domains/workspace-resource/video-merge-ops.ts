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
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import { musicCompositionPlanDurationMs } from '@/lib/music/composition-plan'
import { musicScoreGenerationOptionsSchema } from '@/lib/music/score-specification'

const mergeVideosInputSchema = z.object({
  folderPath: z.string().trim().min(1).max(512).nullable().optional()
    .describe('Optional project-relative destination folder. Missing folders are created atomically with the merged video Resource.'),
  name: z.string().trim().min(1).max(300),
  videos: z.array(z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  }).strict()).min(1).max(50),
  musicCues: z.array(z.object({
    resourceId: z.string().trim().min(1).max(32),
    contentVersion: z.number().int().positive(),
  }).strict()).min(1).max(50).optional(),
}).strict().superRefine((input, context) => {
  if (input.videos.length < 2 && !input.musicCues) {
    context.addIssue({ code: 'custom', path: ['videos'], message: 'A single video requires music cues.' })
  }
  if (input.musicCues && input.videos.length !== 1) {
    context.addIssue({
      code: 'custom',
      path: ['musicCues'],
      message: 'Music cues must be placed onto one already-merged source video.',
    })
  }
  if (input.musicCues) {
    const identities = input.musicCues.map((cue) => `${cue.resourceId}:${String(cue.contentVersion)}`)
    if (new Set(identities).size !== identities.length) {
      context.addIssue({ code: 'custom', path: ['musicCues'], message: 'Music cue references must be unique.' })
    }
  }
})

const mergeVideosOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
  }).passthrough(),
)

type FrozenMusicCuePlacement = {
  readonly inputPosition: number
  readonly startMs: number
  readonly durationMs: number
  readonly fadeInMs: number
  readonly fadeOutMs: number
  readonly gainDb: number
}

async function resolveFrozenMusicCuePlacements(input: {
  readonly userId: string
  readonly projectId: string
  readonly references: readonly WorkspaceResourceInputRef[]
}): Promise<readonly FrozenMusicCuePlacement[]> {
  const sourceVideo = input.references.find((reference) => reference.role === 'source_video')
  const musicReferences = input.references.filter((reference) => reference.role === 'bgm_audio')
  if (musicReferences.length === 0) return []
  if (!sourceVideo || input.references.filter((reference) => reference.role === 'source_video').length !== 1) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_SCORE_SOURCE_INVALID')
  }

  const [timeline] = await resolveWorkspaceResourceInputMedia({
    userId: input.userId,
    projectId: input.projectId,
    references: [sourceVideo],
    expectedMediaType: 'video',
  })
  if (!timeline || timeline.durationMs === null) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_SCORE_TIMELINE_DURATION_MISSING')
  }
  const timelineDurationMs = timeline.durationMs

  const resources = await prisma.workspaceResource.findMany({
    where: {
      id: { in: musicReferences.map((reference) => reference.resourceId) },
      userId: input.userId,
      projectId: input.projectId,
      resourceKind: 'file',
      mediaType: 'audio',
      status: 'ready',
      deletedAt: null,
    },
    select: { id: true, currentVersion: true, generationOptions: true },
  })
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  const lineage = await prisma.workspaceResourceLineage.findMany({
    where: {
      OR: musicReferences.map((reference) => ({
        outputResourceId: reference.resourceId,
        outputVersion: reference.contentVersion,
      })),
    },
    select: {
      outputResourceId: true,
      outputVersion: true,
      inputResourceId: true,
      inputVersion: true,
      role: true,
      position: true,
    },
  })

  return musicReferences.map((reference) => {
    const resource = resourceById.get(reference.resourceId)
    if (!resource || resource.currentVersion !== reference.contentVersion) {
      throw new Error(
        `WORKSPACE_RESOURCE_VIDEO_MERGE_SCORE_PROVENANCE_VERSION_MISMATCH:${reference.resourceId}:${String(reference.contentVersion)}`,
      )
    }
    const specification = musicScoreGenerationOptionsSchema.parse(resource.generationOptions)
    const timelineLineage = lineage.find((candidate) => (
      candidate.outputResourceId === reference.resourceId
      && candidate.outputVersion === reference.contentVersion
      && candidate.role === 'score_timeline'
      && candidate.position === specification.timelineInputPosition
    ))
    if (
      !timelineLineage
      || timelineLineage.inputResourceId !== sourceVideo.resourceId
      || timelineLineage.inputVersion !== sourceVideo.contentVersion
    ) {
      throw new Error(
        `WORKSPACE_RESOURCE_VIDEO_MERGE_SCORE_TIMELINE_MISMATCH:${reference.resourceId}:${String(reference.contentVersion)}`,
      )
    }
    const durationMs = musicCompositionPlanDurationMs(specification.compositionPlan)
    if (specification.startMs + durationMs > timelineDurationMs) {
      throw new Error(
        `WORKSPACE_RESOURCE_VIDEO_MERGE_SCORE_CUE_EXCEEDS_TIMELINE:${reference.resourceId}:${String(reference.contentVersion)}`,
      )
    }
    return {
      inputPosition: reference.position,
      startMs: specification.startMs,
      durationMs,
      fadeInMs: specification.fadeInMs,
      fadeOutMs: specification.fadeOutMs,
      gainDb: specification.gainDb,
    }
  })
}

export function createWorkspaceResourceVideoMergeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    merge_videos: defineOperation({
      id: 'merge_videos',
      summary: 'Concatenate exact frozen video Resource versions, or place exact generated music cue versions onto one already-merged source video, using frozen millisecond timing.',
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
            ...input.videos.map((video, position) => ({ ...video, role: 'source_video', position })),
            ...(input.musicCues ?? []).map((music, index) => ({
              ...music,
              role: 'bgm_audio',
              position: input.videos.length + index,
            })),
          ],
        })
        const musicCues = await resolveFrozenMusicCuePlacements({
          userId: ctx.userId,
          projectId: ctx.projectId,
          references,
        })
        const inputHash = stableArgsFingerprint({ references, musicCues })
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
        const generationOptions: Record<string, string | number> = musicCues.length > 0
          ? { mergeMode: 'score_cues' }
          : { mergeMode: 'ordered_concat' }
        const payload = {
          lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
            resourceId,
            mediaType: 'video',
            schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
            name: workspaceResourceDisplayName({ workspacePath: outputPath, resourceId }),
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
            musicCues,
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
