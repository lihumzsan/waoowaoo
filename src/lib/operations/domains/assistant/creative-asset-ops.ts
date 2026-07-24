import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  assetManifestSchema,
  screenplaySchema,
  validateAssetManifest,
} from '@/lib/screenplay'
import { createOrReuseProjectAssetInTransaction } from '@/lib/assets/services/project-asset-writer'
import {
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  CREATIVE_RESOURCE_SCHEMA,
  resolveProjectCreativeResourceScope,
} from '@/lib/creative-resource'
import { bindCreativeResourceRevisionInTransaction } from '@/lib/creative-resource/binding-service'
import { creativeWorkTaskPayloadSchema } from '@/lib/creative-worker'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const adoptAssetManifestInputSchema = z.object({
  revisionId: z.string().trim().min(1)
    .describe('Exact immutable project.asset_manifest revision to adopt and materialize into project asset identities.'),
  expectedVersion: z.number().int().nonnegative().nullable().optional()
    .describe('Use null for first adoption, or the current adopted asset-manifest binding version when replacing it.'),
}).strict()

const adoptAssetManifestOutputSchema = z.object({
  success: z.literal(true),
  revisionId: z.string().trim().min(1),
  bindingVersion: z.number().int().nonnegative(),
  assets: z.array(z.object({
    manifestAssetId: z.string().trim().min(1),
    kind: z.enum(['character', 'location', 'prop']),
    assetId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
    created: z.boolean(),
  }).strict()),
  imageGenerationStarted: z.literal(false),
}).strict()

export function createAssistantCreativeAssetOperations(): ProjectAgentOperationRegistryDraft {
  return {
    adopt_asset_manifest: defineOperation({
      id: 'adopt_asset_manifest',
      summary: 'Adopt one exact project.asset_manifest Revision grounded in one exact screenplay, then create or reuse the corresponding Project asset identities. Any adopted Creative Direction was already frozen into the generating Task by the server and is not an adoption gate. This operation never generates images or starts downstream Tasks.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'project_assets',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: true,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: adoptAssetManifestInputSchema,
      outputSchema: adoptAssetManifestOutputSchema,
      executeInTransaction: async (context, input, tx) => {
        const revision = await tx.creativeResourceRevision.findFirst({
          where: {
            id: input.revisionId,
            taskId: { not: null },
            resource: {
              userId: context.userId,
              projectId: context.projectId,
              episodeId: null,
              status: 'ready',
              mediaType: 'text',
              schemaId: CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
              sourceType: 'CreativeWorkResult',
            },
          },
          select: {
            id: true,
            resourceId: true,
            contentJson: true,
            taskId: true,
            task: { select: { type: true, status: true, payload: true } },
            outputLineage: { select: { inputRevisionId: true } },
          },
        })
        const taskPayload = creativeWorkTaskPayloadSchema.safeParse(revision?.task?.payload)
        if (
          !revision
          || !revision.taskId
          || !revision.task
          || revision.contentJson === null
          || revision.task.type !== TASK_TYPE.CREATIVE_WORK
          || revision.task.status !== TASK_STATUS.COMPLETED
          || !taskPayload.success
          || taskPayload.data.request.outputKind !== 'asset_manifest'
        ) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'ASSET_MANIFEST_REVISION_PROVENANCE_INVALID',
            field: 'revisionId',
            agentRetryableAfterCorrection: true,
          })
        }
        const lineageIds = [...new Set(revision.outputLineage.map((lineage) => lineage.inputRevisionId))]
        const sources = await tx.creativeResourceRevision.findMany({
          where: {
            id: { in: lineageIds },
            resource: {
              userId: context.userId,
              projectId: context.projectId,
              episodeId: null,
              status: 'ready',
            },
          },
          select: {
            id: true,
            contentJson: true,
            resource: { select: { schemaId: true } },
          },
        })
        if (sources.length !== lineageIds.length) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'ASSET_MANIFEST_SOURCE_LINEAGE_INVALID',
            field: 'revisionId',
            agentRetryableAfterCorrection: true,
          })
        }
        const screenplaySources = sources.filter(
          (source) => source.resource.schemaId === CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
        )
        if (screenplaySources.length !== 1) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'ASSET_MANIFEST_EXACT_SCREENPLAY_SOURCE_REQUIRED',
            field: 'revisionId',
            agentRetryableAfterCorrection: true,
          })
        }
        const screenplaySource = screenplaySources[0]
        if (!screenplaySource || screenplaySource.contentJson === null) {
          throw new Error('ASSET_MANIFEST_SOURCE_CONTENT_MISSING')
        }
        const scope = resolveProjectCreativeResourceScope({
          userId: context.userId,
          projectId: context.projectId,
          episodeId: null,
        })
        const screenplay = screenplaySchema.parse(screenplaySource.contentJson)
        const manifest = validateAssetManifest({
          screenplay,
          manifest: assetManifestSchema.parse(revision.contentJson),
        })
        const assets: Array<{
          manifestAssetId: string
          kind: 'character' | 'location' | 'prop'
          assetId: string
          variantId: string
          created: boolean
        }> = []
        for (const item of manifest.assets) {
          const written = await createOrReuseProjectAssetInTransaction({
            tx,
            projectId: context.projectId,
            kind: item.kind,
            name: item.canonicalName,
            summary: item.stableDescription,
            stableDescription: item.stableDescription,
            manifestAssetId: item.manifestAssetId,
          })
          assets.push({
            manifestAssetId: item.manifestAssetId,
            kind: written.kind,
            assetId: written.assetId,
            variantId: written.variantId,
            created: written.created,
          })
        }
        const binding = await bindCreativeResourceRevisionInTransaction(tx, {
          scope,
          ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedAssetManifest,
          resourceId: revision.resourceId,
          revisionId: revision.id,
          source: 'asset_manifest_adoption',
          expectedVersion: input.expectedVersion ?? null,
        })
        return adoptAssetManifestOutputSchema.parse({
          success: true,
          revisionId: revision.id,
          bindingVersion: binding.version,
          assets,
          imageGenerationStarted: false,
        })
      },
    }),
  }
}
