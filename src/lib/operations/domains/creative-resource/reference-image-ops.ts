import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  buildCreativeResourceId,
  resolveProjectCreativeResourceScope,
} from '@/lib/creative-resource/identity'
import { reserveCreativeResourcesInTransaction } from '@/lib/creative-resource/persistence'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { buildCreativeResourceLifecycleProjection } from '@/lib/creative-resource/task-runtime-envelope'
import { buildWebReferenceImageProvenance } from '@/lib/creative-resource/web-reference-contract'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'
import { dispatchCommittedOutboxCommands } from '@/lib/outbox/dispatcher'
import { createWorkspaceResourceBroadcastsInTransaction } from '@/lib/workspace-resource/resource-change-events'

const httpUrlSchema = z.union([
  z.url().startsWith('http://').max(2_000),
  z.url().startsWith('https://').max(2_000),
])

const importWebReferenceImageInputSchema = z.object({
  imageUrl: httpUrlSchema
    .describe('Exact http(s) image URL copied verbatim from one web_search image result. Never a page URL, a guessed URL, or a URL from anywhere else.'),
  sourceWebsiteUrl: httpUrlSchema
    .describe('Exact http(s) page URL the same image result was found on. Provenance is mandatory and is stored with the imported material.'),
  name: z.string().trim().min(1).max(200)
    .describe('Short display name for this reference material, in the conversation language.'),
  caption: z.string().trim().min(1).max(1_000).nullable()
    .describe('Caption returned with that image result, or null when it had none. Never substitute your own description.'),
}).strict()

const importWebReferenceImageOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
  }).passthrough(),
)

function assertHttpUrl(value: string, field: 'imageUrl' | 'sourceWebsiteUrl'): string {
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'WEB_REFERENCE_IMAGE_URL_UNSUPPORTED',
      field,
      agentRetryableAfterCorrection: true,
    })
  }
  return parsed.toString()
}

export function createCreativeResourceReferenceImageOperations(): ProjectAgentOperationRegistryDraft {
  return {
    import_web_reference_image: defineOperation({
      id: 'import_web_reference_image',
      summary: 'Import one exact image returned by web_search into this project as an owned reference image Resource, so its revision can be passed as an image reference to later image or video generation. Use it only when the visual identity of an unfamiliar subject genuinely cannot be conveyed in words, and only for an image the current run actually received from web_search. Refuse well-known protected characters and franchises, including Disney and Marvel properties. The origin page is recorded, and the result is external reference material, never original project artwork.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: false,
        outputMediaTypes: ['image'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      assistantWriteAuthority: { kind: 'transactional_task_submission' },
      inputSchema: importWebReferenceImageInputSchema,
      outputSchema: importWebReferenceImageOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = ctx.context.episodeId?.trim() || null
        const imageUrl = assertHttpUrl(input.imageUrl, 'imageUrl')
        const sourceWebsiteUrl = assertHttpUrl(input.sourceWebsiteUrl, 'sourceWebsiteUrl')
        // The image URL alone identifies the picture, so the same image imported
        // twice resolves to the same Resource instead of a second copy.
        const inputHash = stableArgsHash({
          operationId: 'import_web_reference_image',
          imageUrl,
        })
        const requestId = [
          'import-web-reference-image',
          ctx.userId,
          ctx.projectId,
          episodeId ?? 'project',
          inputHash,
        ].join(':')
        const resourceId = buildCreativeResourceId({
          operationId: 'import_web_reference_image',
          requestId,
          candidateIndex: 0,
        })
        const payload = {
          lifecycleProjection: buildCreativeResourceLifecycleProjection([{
            resourceId,
            mediaType: 'image',
            schemaId: CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
            name: input.name,
          }]),
          resource: {
            resourceId,
            mediaType: 'image' as const,
            schemaId: CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
            prompt: null,
            modelKey: null,
            inputHash,
            inputs: [] as [],
            generationOptions: buildWebReferenceImageProvenance({
              imageUrl,
              sourceWebsiteUrl,
              caption: input.caption,
            }),
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
          type: TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE,
          targetType: 'CreativeResource',
          targetId: resourceId,
          operationId: 'import_web_reference_image',
          source: ctx.source,
          payload,
          decoratePayload: false,
          dedupeKey: `import_web_reference_image:${resourceId}:${inputHash}`,
          locale: resolveOperationLocale(ctx.context),
          onTaskCreatedInTransaction: async (tx) => {
            await reserveCreativeResourcesInTransaction(tx, {
              scope: resolveProjectCreativeResourceScope({
                userId: ctx.userId,
                projectId: ctx.projectId,
                episodeId,
              }),
              mediaType: 'image',
              schemaId: CREATIVE_RESOURCE_SCHEMA.WEB_REFERENCE_IMAGE,
              operationId: 'import_web_reference_image',
              requestId,
              candidates: [{ resourceId, name: input.name, candidateIndex: 0 }],
            })
            broadcastCommandIds = await createWorkspaceResourceBroadcastsInTransaction({
              tx,
              invocationId: requestId,
              affectedResources: [{ kind: 'creativeResources', projectId: ctx.projectId, episodeId }],
              userId: ctx.userId,
              operationId: 'import_web_reference_image',
            })
          },
        })
        // submitOperationTask returns only after its transaction committed;
        // fast-dispatch the broadcast created in that transaction. Failure only
        // logs — the periodic dispatcher recovers the same durable row.
        await dispatchCommittedOutboxCommands(broadcastCommandIds)
        return importWebReferenceImageOutputSchema.parse({ ...result, resourceId })
      },
    }),
  }
}
