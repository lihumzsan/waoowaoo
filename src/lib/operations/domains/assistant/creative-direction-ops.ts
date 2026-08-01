import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { replaceCreativeResourceBindingInTransaction } from '@/lib/creative-resource/binding-service'
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
  resourceId: z.string().trim().min(1)
    .describe('Exact immutable Creative Direction resource selected by the current choice.'),
}).strict()

const adoptCreativeDirectionOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().trim().min(1),
  schemaId: z.literal(CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION),
  selected: z.literal(true),
}).strict()

export function createAssistantCreativeDirectionOperations(): ProjectAgentOperationRegistryDraft {
  return {
    adopt_creative_direction: defineOperation({
      id: 'adopt_creative_direction',
      summary: 'Select one exact project.creative_direction Resource as the project\'s current Creative Direction. The Creative Task already materialized it; this operation starts no downstream work.',
      intent: 'act',
      toolContractRevision: 'adopt_creative_direction/v2',
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
      },
      confirmation: { kind: 'none', required: false },
      choiceCommit: { enabled: true },
      inputSchema: adoptCreativeDirectionInputSchema,
      outputSchema: adoptCreativeDirectionOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const resource = await transaction.creativeResource.findFirst({
          where: {
            id: input.resourceId,
            taskId: { not: null },
            userId: context.userId,
            projectId: context.projectId,
            episodeId: null,
            scopeKind: 'project',
            scopeId: context.projectId,
            status: 'ready',
            materializedAt: { not: null },
            mediaType: 'text',
            schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
            sourceType: 'CreativeWorkResult',
          },
          select: {
            id: true,
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
        if (!resource || !resource.taskId || !resource.task) {
          throw new ApiError('NOT_FOUND', {
            code: 'CREATIVE_DIRECTION_RESOURCE_NOT_FOUND',
            field: 'resourceId',
          })
        }
        const payload = creativeWorkTaskPayloadSchema.safeParse(resource.task.payload)
        if (
          resource.task.type !== TASK_TYPE.CREATIVE_WORK
          || resource.task.status !== TASK_STATUS.COMPLETED
          || !payload.success
          || payload.data.request.outputKind !== 'creative_direction'
        ) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'CREATIVE_DIRECTION_RESOURCE_PROVENANCE_INVALID',
            field: 'resourceId',
            agentRetryableAfterCorrection: true,
          })
        }
        const scope = resolveProjectCreativeResourceScope({
          userId: context.userId,
          projectId: context.projectId,
          episodeId: null,
        })
        await replaceCreativeResourceBindingInTransaction(transaction, {
          scope,
          ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection,
          resourceId: resource.id,
          source: 'creative_direction_adoption',
        })
        return adoptCreativeDirectionOutputSchema.parse({
          success: true,
          resourceId: resource.id,
          schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
          selected: true,
        })
      },
    }),
  }
}
