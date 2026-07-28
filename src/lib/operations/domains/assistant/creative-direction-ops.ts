import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { bindCreativeResourceRevisionInTransaction } from '@/lib/creative-resource/binding-service'
import {
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  CREATIVE_RESOURCE_SCHEMA,
  resolveProjectCreativeResourceScope,
} from '@/lib/creative-resource'
import { creativeWorkTaskPayloadSchema } from '@/lib/creative-worker'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'

const adoptCreativeDirectionInputSchema = z.object({
  revisionId: z.string().trim().min(1)
    .describe('Exact immutable Creative Direction revision selected by the current choice.'),
  expectedVersion: z.number().int().min(0).nullable().optional()
    .describe('Pass null for the first adoption; pass the current adopted Creative Direction binding version when replacing it.'),
}).strict()

const adoptCreativeDirectionOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  schemaId: z.literal(CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION),
  binding: z.object({
    bindingId: z.string().trim().min(1),
    scope: z.object({
      kind: z.enum(['user', 'project', 'episode']),
      id: z.string().trim().min(1),
      userId: z.string().trim().min(1),
      projectId: z.string().trim().min(1).nullable(),
      episodeId: z.string().trim().min(1).nullable(),
    }).strict(),
    role: z.literal(CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection.role),
    slotKey: z.literal(CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection.slotKey),
    resourceId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    version: z.number().int().min(0),
    source: z.string().trim().min(1),
  }).strict(),
}).strict()

export function createAssistantCreativeDirectionOperations(): ProjectAgentOperationRegistryDraft {
  return {
    adopt_creative_direction: defineOperation({
      id: 'adopt_creative_direction',
      summary: 'Adopt one exact immutable project.creative_direction Resource revision selected by the current action. The Creative Task already materialized the revision; this operation only updates the canonical adopted_creative_direction Binding and starts no downstream work.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'none',
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      choiceCommit: { enabled: true },
      inputSchema: adoptCreativeDirectionInputSchema,
      outputSchema: adoptCreativeDirectionOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const revision = await transaction.creativeResourceRevision.findFirst({
          where: {
            id: input.revisionId,
            taskId: { not: null },
            resource: {
              userId: context.userId,
              projectId: context.projectId,
              episodeId: null,
              scopeKind: 'project',
              scopeId: context.projectId,
              status: 'ready',
              mediaType: 'text',
              schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
              sourceType: 'CreativeWorkResult',
            },
          },
          select: {
            id: true,
            resourceId: true,
            taskId: true,
            task: {
              select: {
                type: true,
                status: true,
                payload: true,
              },
            },
          },
        })
        if (!revision || !revision.taskId || !revision.task) {
          throw new ApiError('NOT_FOUND', {
            code: 'CREATIVE_DIRECTION_REVISION_NOT_FOUND',
            field: 'revisionId',
          })
        }
        const payload = creativeWorkTaskPayloadSchema.safeParse(revision.task.payload)
        if (
          revision.task.type !== TASK_TYPE.CREATIVE_WORK
          || revision.task.status !== TASK_STATUS.COMPLETED
          || !payload.success
          || payload.data.request.outputKind !== 'creative_direction'
        ) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'CREATIVE_DIRECTION_REVISION_PROVENANCE_INVALID',
            field: 'revisionId',
            agentRetryableAfterCorrection: true,
          })
        }
        const scope = resolveProjectCreativeResourceScope({
          userId: context.userId,
          projectId: context.projectId,
          episodeId: null,
        })
        const binding = await bindCreativeResourceRevisionInTransaction(transaction, {
          scope,
          ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection,
          resourceId: revision.resourceId,
          revisionId: revision.id,
          source: 'creative_direction_adoption',
          expectedVersion: input.expectedVersion ?? null,
        })
        return adoptCreativeDirectionOutputSchema.parse({
          success: true,
          resourceId: revision.resourceId,
          revisionId: revision.id,
          schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
          binding,
        })
      },
    }),
  }
}
