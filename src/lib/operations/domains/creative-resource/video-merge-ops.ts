import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import type { CreativeResourceInputRef } from '@/lib/creative-resource/contracts'
import { creativeResourceInputRefSchema } from '@/lib/creative-resource/generation-contract'
import { buildCreativeResourceId, resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import {
  reserveCreativeResourcesInTransaction,
  validateCreativeResourceInputReferencesInTransaction,
} from '@/lib/creative-resource/persistence'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { buildCreativeResourceLifecycleProjection } from '@/lib/creative-resource/task-runtime-envelope'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { refineTaskSubmitOperationOutputSchema, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'
import { dispatchCommittedOutboxCommands } from '@/lib/outbox/dispatcher'
import { createWorkspaceResourceBroadcastsInTransaction } from '@/lib/workspace-resource/resource-change-events'

const mergeVideosInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional()
    .describe('Optional display name for the merged ordinary video Resource.'),
  videos: z.array(creativeResourceInputRefSchema).min(1).max(50)
    .describe('Exact ready video Resources in playback order. The array order is the merge order. A single video is only accepted together with music.'),
  music: creativeResourceInputRefSchema.optional()
    .describe('Optional exact ready audio Resource mixed under the whole merged timeline as background music. The server loudness-normalizes, fades, and ducks it under source dialogue deterministically; the merged video duration trims or pads the music. Never put video or text Resources here.'),
}).strict()

const MERGE_VIDEOS_BGM_VOLUME = 1

const mergeVideosOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
  }).passthrough(),
)

function normalizeMergeInputs(
  input: z.infer<typeof mergeVideosInputSchema>,
): CreativeResourceInputRef[] {
  const videos: CreativeResourceInputRef[] = input.videos.map((video, position) => ({
    resourceId: video.resourceId,
    role: 'source_video',
    position,
  }))
  if (!input.music) return videos
  return [
    ...videos,
    { resourceId: input.music.resourceId, role: 'bgm_audio', position: input.videos.length },
  ]
}

export function createCreativeResourceVideoMergeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    merge_videos: defineOperation({
      id: 'merge_videos',
      summary: 'Merge one or more exact ready video Resources into one ordinary video Resource, in the provided order, optionally mixing one exact ready audio Resource under the whole timeline as background music. This preserves and loudness-normalizes source audio, ducks music under source dialogue, performs no generative model call, and does not require the professional chapter pipeline. A single video is only accepted together with music.',
      intent: 'act',
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
        outputMediaTypes: ['video'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      inputSchema: mergeVideosInputSchema,
      outputSchema: mergeVideosOutputSchema,
      execute: async (ctx, input) => {
        if (input.videos.length < 2 && !input.music) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'VIDEO_MERGE_SINGLE_VIDEO_REQUIRES_MUSIC',
            field: 'videos',
            agentRetryableAfterCorrection: true,
          })
        }
        const episodeId = ctx.context.episodeId?.trim() || null
        const references = normalizeMergeInputs(input)
        const inputHash = stableArgsHash({ operationId: 'merge_videos', references })
        const requestId = [
          'merge-videos',
          ctx.userId,
          ctx.projectId,
          episodeId ?? 'project',
          ctx.context.runId?.trim() || 'no-run',
          ctx.toolCallId?.trim() || inputHash,
          inputHash,
        ].join(':')
        const resourceId = buildCreativeResourceId({
          operationId: 'merge_videos',
          requestId,
          candidateIndex: 0,
        })
        const resourceName = input.name ?? 'Merged video'
        const generationOptions = input.music
          ? { mergeMode: 'ordered_concat' as const, bgmVolume: MERGE_VIDEOS_BGM_VOLUME }
          : { mergeMode: 'ordered_concat' as const }
        const payload = {
          lifecycleProjection: buildCreativeResourceLifecycleProjection([{
            resourceId,
            mediaType: 'video',
            schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
            name: resourceName,
          }]),
          resource: {
            resourceId,
            mediaType: 'video' as const,
            schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
            prompt: null,
            modelKey: null,
            inputHash,
            inputs: references,
            generationOptions,
            executionSegmentId: ctx.context.executionSegmentId?.trim() || null,
            toolCallId: ctx.toolCallId?.trim() || null,
          },
        }
        let broadcastCommandIds: readonly string[] = []
        const result = await submitOperationTask({
          request: ctx.request,
          userId: ctx.userId,
          projectId: ctx.projectId,
          episodeId,
          type: TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE,
          targetType: 'CreativeResource',
          targetId: resourceId,
          operationId: 'merge_videos',
          source: ctx.source,
          payload,
          decoratePayload: false,
          dedupeKey: `merge_videos:${resourceId}:${inputHash}`,
          locale: resolveOperationLocale(ctx.context),
          onTaskCreatedInTransaction: async (tx) => {
            await validateCreativeResourceInputReferencesInTransaction(tx, ctx.userId, references)
            const resources = await tx.creativeResource.findMany({
              where: { id: { in: references.map((reference) => reference.resourceId) } },
              select: { id: true, projectId: true, mediaType: true },
            })
            const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
            for (const reference of references) {
              const resource = resourceById.get(reference.resourceId)
              const expectedMediaType = reference.role === 'bgm_audio' ? 'audio' : 'video'
              if (!resource || resource.mediaType !== expectedMediaType || (resource.projectId && resource.projectId !== ctx.projectId)) {
                throw new ApiError('INVALID_PARAMS', {
                  code: 'VIDEO_MERGE_INPUT_RESOURCE_INVALID',
                  field: reference.role === 'bgm_audio' ? 'music' : 'videos',
                  resourceId: reference.resourceId,
                  agentRetryableAfterCorrection: true,
                })
              }
            }
            await reserveCreativeResourcesInTransaction(tx, {
              scope: resolveProjectCreativeResourceScope({
                userId: ctx.userId,
                projectId: ctx.projectId,
                episodeId,
              }),
              mediaType: 'video',
              schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
              operationId: 'merge_videos',
              requestId,
              candidates: [{ resourceId, name: resourceName, candidateIndex: 0 }],
            })
            broadcastCommandIds = await createWorkspaceResourceBroadcastsInTransaction({
              tx,
              invocationId: requestId,
              affectedResources: [{ kind: 'creativeResources', projectId: ctx.projectId, episodeId }],
              userId: ctx.userId,
              operationId: 'merge_videos',
            })
          },
        })
        // submitOperationTask returns only after its transaction committed;
        // fast-dispatch the broadcast created in that transaction. Failure only
        // logs — the periodic dispatcher recovers the same durable row.
        await dispatchCommittedOutboxCommands(broadcastCommandIds)
        return mergeVideosOutputSchema.parse({ ...result, resourceId })
      },
    }),
  }
}
