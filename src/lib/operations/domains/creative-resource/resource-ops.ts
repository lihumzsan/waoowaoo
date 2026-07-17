import { z } from 'zod'
import { bindCreativeResourceRevisionInTransaction } from '@/lib/creative-resource/binding-service'
import { CREATIVE_RESOURCE_MEDIA_TYPES, CREATIVE_RESOURCE_STATUSES } from '@/lib/creative-resource/contracts'
import { resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import {
  getProjectCreativeResourceCard,
  listProjectCreativeResourceCards,
} from '@/lib/creative-resource/view-service'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { CREATIVE_RESOURCE_SCHEMAS } from '@/lib/creative-resource/schema-registry'

const creativeResourceSchemaIds = CREATIVE_RESOURCE_SCHEMAS.map((definition) => definition.schemaId)

const listResourcesInputSchema = z.object({
  episodeId: z.string().trim().min(1).nullable().optional(),
  includeProjectScope: z.boolean().optional(),
  mediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES).optional(),
  schemaId: z.enum(creativeResourceSchemaIds).optional()
    .describe('Optional exact professional Resource schema to filter by. Pass null to include every schema.'),
  status: z.enum(CREATIVE_RESOURCE_STATUSES).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict()

const getResourceInputSchema = z.object({
  resourceId: z.string().trim().min(1),
}).strict()

const adoptResourceInputSchema = z.object({
  episodeId: z.string().trim().min(1).nullable().optional(),
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  role: z.string().trim().min(1).max(64),
  slotKey: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().min(0).nullable().optional(),
}).strict()

const resourceCardSchema = z.object({
  resource: z.object({
    resourceId: z.string().min(1),
    origin: z.object({
      sourceType: z.string().min(1),
      sourceId: z.string().min(1),
    }).strict().nullable(),
    scope: z.object({
      kind: z.enum(['user', 'project', 'episode']),
      id: z.string().min(1),
      userId: z.string().min(1),
      projectId: z.string().nullable(),
      episodeId: z.string().nullable(),
    }).strict(),
    mediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES),
    schemaId: z.string().min(1),
    name: z.string().min(1),
    status: z.enum(CREATIVE_RESOURCE_STATUSES),
    candidateSetId: z.string().nullable(),
    candidateIndex: z.number().int().min(0).nullable(),
    headRevision: z.unknown().nullable(),
    bindings: z.array(z.unknown()),
    error: z.object({ code: z.string().nullable(), message: z.string() }).strict().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }).strict(),
  candidates: z.unknown().nullable(),
  presentation: z.object({
    rendererKey: z.string().min(1),
    fallbackMediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES),
  }).strict(),
}).strict()

const listResourcesOutputSchema = z.object({
  success: z.literal(true),
  resources: z.array(resourceCardSchema),
}).strict()

const getResourceOutputSchema = z.object({
  success: z.literal(true),
  resource: resourceCardSchema,
}).strict()

const adoptResourceOutputSchema = z.object({
  success: z.literal(true),
  binding: z.object({
    bindingId: z.string().min(1),
    scope: z.object({
      kind: z.enum(['user', 'project', 'episode']),
      id: z.string().min(1),
      userId: z.string().min(1),
      projectId: z.string().nullable(),
      episodeId: z.string().nullable(),
    }).strict(),
    role: z.string().min(1),
    slotKey: z.string().min(1),
    resourceId: z.string().min(1),
    revisionId: z.string().min(1),
    version: z.number().int().min(0),
    source: z.string().min(1),
  }).strict(),
}).strict()

export function createCreativeResourceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    list_resources: defineOperation({
      id: 'list_resources',
      summary: 'List persistent creative Resources with exact revision, prompt, model, lineage, candidate, and adoption facts. This is not a Workflow-stage query.',
      intent: 'query',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: listResourcesInputSchema,
      outputSchema: listResourcesOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = input.episodeId === undefined ? (ctx.context.episodeId ?? null) : input.episodeId
        const episodeResources = await listProjectCreativeResourceCards({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          mediaType: input.mediaType,
          schemaId: input.schemaId,
          status: input.status,
          limit: input.limit,
        })
        const projectResources = input.includeProjectScope && episodeId
          ? await listProjectCreativeResourceCards({
              projectId: ctx.projectId,
              userId: ctx.userId,
              episodeId: null,
              mediaType: input.mediaType,
              schemaId: input.schemaId,
              status: input.status,
              limit: input.limit,
            })
          : []
        return listResourcesOutputSchema.parse({ success: true, resources: [...projectResources, ...episodeResources] })
      },
    }),
    get_resource: defineOperation({
      id: 'get_resource',
      summary: 'Read one persistent creative Resource by canonical identity, including its head revision, generation provenance, exact lineage, candidates, and bindings.',
      intent: 'query',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: getResourceInputSchema,
      outputSchema: getResourceOutputSchema,
      execute: async (ctx, input) => {
        const resource = await getProjectCreativeResourceCard({
          projectId: ctx.projectId,
          userId: ctx.userId,
          resourceId: input.resourceId,
        })
        if (!resource) throw new Error(`CREATIVE_RESOURCE_NOT_FOUND:${input.resourceId}`)
        return getResourceOutputSchema.parse({ success: true, resource })
      },
    }),
    adopt_resource: defineOperation({
      id: 'adopt_resource',
      summary: 'Adopt an exact immutable Resource revision into a named project or episode role. Generation and adoption remain separate; this does not modify the Resource.',
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
      confirmation: { kind: 'none', required: false },
      inputSchema: adoptResourceInputSchema,
      outputSchema: adoptResourceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        const episodeId = input.episodeId === undefined ? (ctx.context.episodeId ?? null) : input.episodeId
        const binding = await bindCreativeResourceRevisionInTransaction(tx, {
          scope: resolveProjectCreativeResourceScope({
            userId: ctx.userId,
            projectId: ctx.projectId,
            episodeId,
          }),
          role: input.role,
          slotKey: input.slotKey,
          resourceId: input.resourceId,
          revisionId: input.revisionId,
          source: 'agent',
          expectedVersion: input.expectedVersion ?? null,
        })
        return adoptResourceOutputSchema.parse({ success: true, binding })
      },
    }),
  }
}
