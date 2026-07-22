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

const adoptStyleBibleInputSchema = z.object({
  resourceId: z.string().trim().min(1)
    .describe('Exact project.style_bible Resource materialized by a completed Creative Task.'),
  revisionId: z.string().trim().min(1)
    .describe('Exact immutable Style Bible revision selected by the current choice.'),
  fingerprint: z.string().trim().min(1)
    .describe('Exact persisted fingerprint returned with revisionId. Never infer it from content.'),
  expectedVersion: z.number().int().min(0).nullable().optional()
    .describe('Pass null for the first adoption; pass the current canonical style binding version when replacing it.'),
}).strict()

const adoptStyleBibleOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1),
  schemaId: z.literal(CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE),
  binding: z.object({
    bindingId: z.string().trim().min(1),
    scope: z.object({
      kind: z.enum(['user', 'project', 'episode']),
      id: z.string().trim().min(1),
      userId: z.string().trim().min(1),
      projectId: z.string().trim().min(1).nullable(),
      episodeId: z.string().trim().min(1).nullable(),
    }).strict(),
    role: z.literal(CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedStyleBible.role),
    slotKey: z.literal(CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedStyleBible.slotKey),
    resourceId: z.string().trim().min(1),
    revisionId: z.string().trim().min(1),
    version: z.number().int().min(0),
    source: z.string().trim().min(1),
  }).strict(),
}).strict()

export function createAssistantCreativeStyleOperations(): ProjectAgentOperationRegistryDraft {
  return {
    adopt_style_bible: defineOperation({
      id: 'adopt_style_bible',
      summary: 'Adopt one exact immutable project.style_bible Resource revision selected by the current action. The Creative Task already materialized the revision; this operation only updates the canonical adopted_style_bible Binding and starts no downstream work.',
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
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE],
        supportsCandidates: false,
      },
      confirmation: { kind: 'none', required: false },
      choiceCommit: { enabled: true },
      inputSchema: adoptStyleBibleInputSchema,
      outputSchema: adoptStyleBibleOutputSchema,
      executeInTransaction: async (context, input, transaction) => {
        const revision = await transaction.creativeResourceRevision.findFirst({
          where: {
            id: input.revisionId,
            resourceId: input.resourceId,
            fingerprint: input.fingerprint,
            taskId: { not: null },
            resource: {
              userId: context.userId,
              projectId: context.projectId,
              status: 'ready',
              mediaType: 'text',
              schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
              sourceType: 'CreativeWorkResult',
            },
          },
          select: {
            id: true,
            resourceId: true,
            fingerprint: true,
            taskId: true,
            task: {
              select: {
                type: true,
                status: true,
                payload: true,
              },
            },
            resource: {
              select: {
                episodeId: true,
              },
            },
          },
        })
        if (!revision || !revision.taskId || !revision.task) {
          throw new ApiError('NOT_FOUND', {
            code: 'CREATIVE_STYLE_BIBLE_REVISION_NOT_FOUND',
            field: 'revisionId',
          })
        }
        const payload = creativeWorkTaskPayloadSchema.safeParse(revision.task.payload)
        if (
          revision.task.type !== TASK_TYPE.CREATIVE_WORK
          || revision.task.status !== TASK_STATUS.COMPLETED
          || !payload.success
          || payload.data.request.outputKind !== 'style_bible'
        ) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'CREATIVE_STYLE_BIBLE_REVISION_PROVENANCE_INVALID',
            field: 'revisionId',
            agentRetryableAfterCorrection: true,
          })
        }
        const scope = resolveProjectCreativeResourceScope({
          userId: context.userId,
          projectId: context.projectId,
          episodeId: revision.resource.episodeId,
        })
        const binding = await bindCreativeResourceRevisionInTransaction(transaction, {
          scope,
          ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedStyleBible,
          resourceId: revision.resourceId,
          revisionId: revision.id,
          source: 'style_adoption',
          expectedVersion: input.expectedVersion ?? null,
        })
        return adoptStyleBibleOutputSchema.parse({
          success: true,
          resourceId: revision.resourceId,
          revisionId: revision.id,
          fingerprint: revision.fingerprint,
          schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE,
          binding,
        })
      },
    }),
  }
}
