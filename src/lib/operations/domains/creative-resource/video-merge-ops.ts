import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import type { CreativeResourceInputRef } from '@/lib/creative-resource/contracts'
import { creativeResourceInputRefSchema } from '@/lib/creative-resource/generation-contract'
import { buildCreativeResourceOriginKey, resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import {
  reserveCreativeResourcesInTransaction,
  validateCreativeResourceInputReferencesInTransaction,
} from '@/lib/creative-resource/persistence'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import { refineTaskSubmitOperationOutputSchema, taskSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'
import { createWorkspaceResourceBroadcastsInTransaction } from '@/lib/workspace-resource/resource-change-events'

const mergeVideosInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional()
    .describe('Optional display name for the merged ordinary video Resource.'),
  videos: z.array(creativeResourceInputRefSchema).min(2).max(50)
    .describe('Exact ready video Resource revisions in playback order. The array order is the merge order.'),
}).strict()

const mergeVideosOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
  }).passthrough(),
)

function normalizeVideoInputs(
  videos: z.infer<typeof mergeVideosInputSchema>['videos'],
): CreativeResourceInputRef[] {
  return videos.map((video, position) => ({
    resourceId: video.resourceId,
    revisionId: video.revisionId,
    fingerprint: video.fingerprint,
    role: 'source_video',
    position,
  }))
}

export function createCreativeResourceVideoMergeOperations(): ProjectAgentOperationRegistryDraft {
  return {
    merge_videos: defineOperation({
      id: 'merge_videos',
      summary: 'Merge two or more exact ready video Resource revisions into one ordinary video Resource, in the provided order. This preserves source audio, performs no generative model call, and does not require the professional chapter pipeline.',
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
        const episodeId = ctx.context.episodeId?.trim() || null
        const references = normalizeVideoInputs(input.videos)
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
        const resourceId = buildCreativeResourceOriginKey({
          operationId: 'merge_videos',
          requestId,
          candidateIndex: 0,
        })
        const generationOptions = { mergeMode: 'ordered_concat' as const }
        const payload = {
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
              if (!resource || resource.mediaType !== 'video' || (resource.projectId && resource.projectId !== ctx.projectId)) {
                throw new ApiError('INVALID_PARAMS', {
                  code: 'VIDEO_MERGE_INPUT_RESOURCE_INVALID',
                  field: 'videos',
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
              candidates: [{ resourceId, name: input.name ?? 'Merged video', candidateIndex: 0 }],
            })
            await createWorkspaceResourceBroadcastsInTransaction({
              tx,
              invocationId: requestId,
              affectedResources: [{ kind: 'creativeResources', projectId: ctx.projectId, episodeId }],
              userId: ctx.userId,
              operationId: 'merge_videos',
            })
          },
        })
        return mergeVideosOutputSchema.parse({ ...result, resourceId })
      },
    }),
  }
}
